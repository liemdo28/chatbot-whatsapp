import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
    GmailInboxClient,
    ImapAuthenticationError,
    ImapConnectionError,
    type GmailInboxMessage,
} from '../../integrations/email/gmail-inbox-client.js';
import { parseMarketingReportFile, type ParsedMarketingCampaign, type ParsedMarketingReport } from '../../reporting/marketing-report-parser.js';
import { campaignMatchesStore } from '../../reporting/marketing-report-store-match.js';
import { weeklyProductionRunScheduledAtUtc } from '../../automation/weekly-reporting-window.js';
import type { ProductionWorkflowConfig } from '../config.js';
import type { IngestionIdempotencyRecord, ProductionStore, WeeklyCampaignSnapshot } from '../types.js';
import type { ProductionStorage, SnapshotUpsertResult } from '../storage/production-storage.js';
import {
    ReportAuthenticationError,
    ReportDeliveryWindowExpiredError,
    ReportInboxUnavailableError,
    ReportNotReadyError,
    ReportStoreMismatchError,
    UnsupportedReportArtifactError,
} from './report-ingestion-errors.js';

export interface WeeklyWindow {
    weekStart: string;
    weekEndExclusive: string;
    startLabel: string;
    endLabel: string;
    label: string;
}

export interface WeeklyReportIngestionResult {
    storeId: string;
    reportPath: string;
    messageId: string;
    sourceRef: string;
    idempotencyKey: string;
    parsedReport: ParsedMarketingReport;
    matchedCampaigns: ParsedMarketingCampaign[];
    upsert: SnapshotUpsertResult;
    alreadyProcessed: boolean;
}

export interface PreparedWeeklyReportIngestion {
    attachmentHash: string;
    idempotencyKey: string;
    matchedCampaigns: ParsedMarketingCampaign[];
    messageId: string;
    parsedReport: ParsedMarketingReport;
    reportPath: string;
    snapshots: WeeklyCampaignSnapshot[];
    sourceRef: string;
    storeId: string;
}

const MAX_REPORT_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const REPORT_LINK_TIMEOUT_MS = 15_000;
const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set(['.zip', '.csv', '.xlsx', '.xls']);
const SUPPORTED_ATTACHMENT_CONTENT_TYPES = new Set([
    'application/octet-stream',
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
]);

function normalizeValue(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function shiftIsoDate(isoDate: string, days: number): string {
    const base = new Date(`${isoDate}T00:00:00.000Z`);
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
}

function safeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 180);
}

function attachmentDirectory(config: ProductionWorkflowConfig): string {
    const dir = path.resolve(os.tmpdir(), 'doordash-weekly-production', 'downloaded-reports');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function messageFromAllowedSender(message: GmailInboxMessage, config: ProductionWorkflowConfig): boolean {
    const senders = message.from.map(normalizeValue);
    return config.reportAllowedSenders.some(sender => senders.includes(normalizeValue(sender)));
}

function subjectLooksRelevant(message: GmailInboxMessage, store: ProductionStore, config: ProductionWorkflowConfig): boolean {
    const subject = normalizeValue(message.subject);
    const storeTokens = [
        normalizeValue(store.name),
        normalizeValue(store.id),
        normalizeValue(store.doorDashAccountId),
        normalizeValue(store.name).replace(/[^a-z0-9]+/g, '-'),
    ].filter(Boolean);
    return config.reportSubjectIncludes.some(token => subject.includes(normalizeValue(token)))
        && storeTokens.some(token => subject.includes(token));
}

function attachmentHasSupportedType(attachment: GmailInboxMessage['attachments'][number]): boolean {
    const extension = path.extname(attachment.filename).toLowerCase();
    if (!SUPPORTED_ATTACHMENT_EXTENSIONS.has(extension)) return false;
    return SUPPORTED_ATTACHMENT_CONTENT_TYPES.has(normalizeValue(attachment.contentType || 'application/octet-stream'));
}

function findSupportedAttachment(message: GmailInboxMessage): { filename: string; content: Buffer } | null {
    const attachment = message.attachments.find(attachmentHasSupportedType);
    if (!attachment) return null;
    if (attachment.content.length > MAX_REPORT_ATTACHMENT_BYTES) {
        throw new UnsupportedReportArtifactError(
            `Message ${message.messageId} attachment ${safeFileName(attachment.filename)} exceeds the ${MAX_REPORT_ATTACHMENT_BYTES} byte safety limit.`,
        );
    }
    return { filename: attachment.filename, content: attachment.content };
}

function findOfficialExportLink(message: GmailInboxMessage): string | null {
    const match = `${message.subject}\n${message.text}`.match(/https?:\/\/\S+\.(zip|csv|xlsx|xls)(\?\S+)?/i);
    return match ? match[0] : null;
}

async function downloadReportLink(targetUrl: string, config: ProductionWorkflowConfig, messageId: string): Promise<{ filePath: string; hash: string }> {
    const headers: Record<string, string> = {};
    if (process.env['DD_REPORT_LINK_AUTHORIZATION']) {
        headers['Authorization'] = process.env['DD_REPORT_LINK_AUTHORIZATION']!;
    }
    if (process.env['DD_REPORT_LINK_COOKIE']) {
        headers['Cookie'] = process.env['DD_REPORT_LINK_COOKIE']!;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REPORT_LINK_TIMEOUT_MS);

    try {
        const response = await fetch(targetUrl, { headers, signal: controller.signal });
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new ReportAuthenticationError(`Official report link download failed authentication with HTTP ${response.status}.`);
            }
            throw new UnsupportedReportArtifactError(`Official report link download failed with HTTP ${response.status}.`);
        }

        const declaredLength = Number(response.headers.get('content-length') || '0');
        if (Number.isFinite(declaredLength) && declaredLength > MAX_REPORT_ATTACHMENT_BYTES) {
            throw new UnsupportedReportArtifactError(`Official report link download exceeded the ${MAX_REPORT_ATTACHMENT_BYTES} byte safety limit.`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const content = Buffer.from(arrayBuffer);
        if (content.length > MAX_REPORT_ATTACHMENT_BYTES) {
            throw new UnsupportedReportArtifactError(`Official report link download exceeded the ${MAX_REPORT_ATTACHMENT_BYTES} byte safety limit.`);
        }
        const extension = path.extname(new URL(targetUrl).pathname) || '.bin';
        const filePath = path.resolve(attachmentDirectory(config), `${safeFileName(messageId)}${extension}`);
        fs.writeFileSync(filePath, content);
        return {
            filePath,
            hash: crypto.createHash('sha256').update(content).digest('hex'),
        };
    } catch (error) {
        if (error instanceof ReportAuthenticationError || error instanceof UnsupportedReportArtifactError) {
            throw error;
        }
        throw new ReportInboxUnavailableError('Official report link download timed out or the mailbox transport was unavailable.');
    } finally {
        clearTimeout(timeout);
    }
}

function persistAttachment(message: GmailInboxMessage, attachment: { filename: string; content: Buffer }, config: ProductionWorkflowConfig): { filePath: string; hash: string } {
    const hash = crypto.createHash('sha256').update(attachment.content).digest('hex');
    const filePath = path.resolve(
        attachmentDirectory(config),
        `${safeFileName(message.messageId)}-${safeFileName(attachment.filename)}`,
    );
    fs.writeFileSync(filePath, attachment.content);
    return { filePath, hash };
}

function buildIdempotencyKey(messageId: string, attachmentHash: string, storeId: string, weekStart: string): string {
    return crypto
        .createHash('sha256')
        .update([messageId, attachmentHash, storeId, weekStart].join('|'))
        .digest('hex');
}

function campaignIdentityToken(campaign: ParsedMarketingCampaign): string {
    return campaign.campaignId || normalizeValue(campaign.campaignName).replace(/[^a-z0-9]+/g, '_');
}

function buildSnapshotId(storeId: string, weekStart: string, campaign: ParsedMarketingCampaign, sourceRef: string): string {
    return crypto
        .createHash('sha256')
        .update([storeId, weekStart, campaignIdentityToken(campaign)].join('|'))
        .digest('hex')
        .slice(0, 24);
}

function validateParsedReport(parsedReport: ParsedMarketingReport, store: ProductionStore, window: WeeklyWindow): ParsedMarketingCampaign[] {
    if (parsedReport.campaigns.length === 0) {
        throw new UnsupportedReportArtifactError(`Marketing report ${path.basename(parsedReport.reportPath)} contains no campaign rows.`);
    }
    if (!parsedReport.reportTypes.length) {
        throw new UnsupportedReportArtifactError(`Marketing report ${path.basename(parsedReport.reportPath)} does not declare a supported report type.`);
    }

    const expectedEndInclusive = shiftIsoDate(window.weekEndExclusive, -1);
    const allowedEndDates = new Set([expectedEndInclusive, window.weekEndExclusive]);
    if (parsedReport.observedDateStart !== window.weekStart || !allowedEndDates.has(parsedReport.observedDateEnd || '')) {
        throw new UnsupportedReportArtifactError(
            `Marketing report ${path.basename(parsedReport.reportPath)} is stale or partial. Expected ${window.weekStart} to ${expectedEndInclusive} (or ${window.weekEndExclusive} when DoorDash includes the boundary day), got ${parsedReport.observedDateStart || 'n/a'} to ${parsedReport.observedDateEnd || 'n/a'}.`,
        );
    }

    const matchedCampaigns = parsedReport.campaigns.filter(campaign => campaignMatchesStore(campaign, store));
    if (matchedCampaigns.length === 0) {
        throw new ReportStoreMismatchError(`Marketing report ${path.basename(parsedReport.reportPath)} does not match store ${store.id}.`);
    }

    if (store.doorDashAccountId) {
        const invalidStoreIds = matchedCampaigns
            .map(campaign => campaign.storeId)
            .filter(storeId => normalizeValue(storeId) !== normalizeValue(store.doorDashAccountId));
        if (invalidStoreIds.length > 0) {
            throw new ReportStoreMismatchError(`Marketing report ${path.basename(parsedReport.reportPath)} failed Store ID validation for ${store.id}. Expected ${store.doorDashAccountId}.`);
        }
    }

    for (const campaign of matchedCampaigns) {
        if (campaign.rowCount <= 0) {
            throw new UnsupportedReportArtifactError(`Marketing report ${path.basename(parsedReport.reportPath)} contains an empty campaign for ${campaign.campaignName}.`);
        }
    }

    return matchedCampaigns;
}

function toWeeklySnapshots(
    store: ProductionStore,
    window: WeeklyWindow,
    parsedReport: ParsedMarketingReport,
    matchedCampaigns: ParsedMarketingCampaign[],
    sourceRef: string,
): WeeklyCampaignSnapshot[] {
    const batchId = `batch-${crypto.createHash('sha256').update([store.id, window.weekStart, parsedReport.attachmentHash].join('|')).digest('hex').slice(0, 20)}`;
    const createdAt = new Date().toISOString();
    return matchedCampaigns.map(campaign => ({
        id: buildSnapshotId(store.id, window.weekStart, campaign, sourceRef),
        storeId: store.id,
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        campaignType: campaign.campaignType.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        status: !campaign.endDate || campaign.endDate === 'None' || campaign.endDate >= window.weekEndExclusive ? 'active' : 'ended',
        weekStart: window.weekStart,
        weekEndExclusive: window.weekEndExclusive,
        snapshotSource: 'email_export',
        sourceRef,
        batchId,
        reportStartDate: window.startLabel,
        reportEndDate: window.endLabel,
        observedDateStart: campaign.observedDateStart,
        observedDateEnd: campaign.observedDateEnd,
        orders: campaign.orders,
        sales: campaign.sales,
        spend: campaign.spend,
        roas: campaign.roas,
        startDate: campaign.startDate || null,
        endDate: campaign.endDate || null,
        dataCompleteness: 4,
        rawDataJson: JSON.stringify({
            reportPath: path.basename(parsedReport.reportPath),
            reportTypes: parsedReport.reportTypes,
            attachmentHash: parsedReport.attachmentHash,
            campaign,
        }),
        createdAt,
        updatedAt: createdAt,
    }));
}

async function resolveReportArtifact(
    message: GmailInboxMessage,
    config: ProductionWorkflowConfig,
): Promise<{ filePath: string; hash: string }> {
    const attachment = findSupportedAttachment(message);
    if (attachment) {
        return persistAttachment(message, attachment, config);
    }

    const link = findOfficialExportLink(message);
    if (link) {
        return downloadReportLink(link, config, message.messageId);
    }

    throw new UnsupportedReportArtifactError(`Message ${message.messageId} does not contain a supported report attachment or official export link.`);
}

async function locateCandidateMessages(config: ProductionWorkflowConfig): Promise<GmailInboxMessage[]> {
    const client = new GmailInboxClient();
    try {
        const messages = await client.fetchRecentMessages(config.reportLookbackHours, config.reportInboxLabel);
        return messages.filter(message => messageFromAllowedSender(message, config));
    } catch (error) {
        if (error instanceof ImapAuthenticationError) {
            throw new ReportAuthenticationError(error.message);
        }
        if (error instanceof ImapConnectionError) {
            throw new ReportInboxUnavailableError(error.message);
        }
        throw error;
    }
}

export async function prepareWeeklyReportForStore(input: {
    config: ProductionWorkflowConfig;
    store: ProductionStore;
    window: WeeklyWindow;
    messages?: GmailInboxMessage[];
    now?: Date;
}): Promise<PreparedWeeklyReportIngestion> {
    const messages = input.messages || await locateCandidateMessages(input.config);
    const candidates = messages.filter(message => subjectLooksRelevant(message, input.store, input.config));

    if (candidates.length === 0) {
        const scheduledRunAt = weeklyProductionRunScheduledAtUtc(input.window);
        const deliveryDeadline = new Date(scheduledRunAt.getTime() + (input.config.reportDeliveryGraceHours * 60 * 60 * 1000));
        const now = input.now || new Date();
        if (now.getTime() > deliveryDeadline.getTime()) {
            throw new ReportDeliveryWindowExpiredError(
                `DoorDash report delivery window expired for store ${input.store.id} and week ${input.window.weekStart}. No matching report arrived before ${deliveryDeadline.toISOString()}.`,
            );
        }
        throw new ReportNotReadyError(
            `DoorDash report has not arrived yet for store ${input.store.id} and week ${input.window.weekStart}. The workflow will retry until ${deliveryDeadline.toISOString()}.`,
        );
    }

    let lastError: Error | null = null;
    for (const message of candidates) {
        try {
            const artifact = await resolveReportArtifact(message, input.config);
            const parsedReport = parseMarketingReportFile(artifact.filePath);
            const matchedCampaigns = validateParsedReport(parsedReport, input.store, input.window);
            const idempotencyKey = buildIdempotencyKey(message.messageId, artifact.hash, input.store.id, input.window.weekStart);
            const sourceRef = path.basename(artifact.filePath);
            const snapshots = toWeeklySnapshots(input.store, input.window, parsedReport, matchedCampaigns, sourceRef);
            return {
                storeId: input.store.id,
                reportPath: artifact.filePath,
                messageId: message.messageId,
                sourceRef,
                idempotencyKey,
                parsedReport,
                matchedCampaigns,
                snapshots,
                attachmentHash: artifact.hash,
            };
        } catch (error) {
            lastError = error as Error;
        }
    }

    throw lastError || new Error(`No usable report artifact was found for store ${input.store.id}.`);
}

export async function ingestWeeklyReportForStore(input: {
    storage: ProductionStorage;
    config: ProductionWorkflowConfig;
    store: ProductionStore;
    window: WeeklyWindow;
    messages?: GmailInboxMessage[];
    now?: Date;
}): Promise<WeeklyReportIngestionResult> {
    const prepared = await prepareWeeklyReportForStore({
        config: input.config,
        store: input.store,
        window: input.window,
        messages: input.messages,
        now: input.now,
    });
    const record: IngestionIdempotencyRecord = {
        idempotencyKey: prepared.idempotencyKey,
        messageId: prepared.messageId,
        attachmentHash: prepared.attachmentHash,
        storeId: input.store.id,
        weekStart: input.window.weekStart,
        sourceRef: prepared.sourceRef,
        createdAt: new Date().toISOString(),
    };
    const alreadyProcessed = await input.storage.hasIngestionRecord(prepared.idempotencyKey);
    if (alreadyProcessed) {
        return {
            storeId: prepared.storeId,
            reportPath: prepared.reportPath,
            messageId: prepared.messageId,
            sourceRef: prepared.sourceRef,
            idempotencyKey: prepared.idempotencyKey,
            parsedReport: prepared.parsedReport,
            matchedCampaigns: prepared.matchedCampaigns,
            upsert: { created: 0, updated: 0, unchanged: prepared.matchedCampaigns.length },
            alreadyProcessed: true,
        };
    }

    const upsert = await input.storage.upsertSnapshots(prepared.snapshots);
    await input.storage.saveIngestionRecord(record);
    return {
        storeId: prepared.storeId,
        reportPath: prepared.reportPath,
        messageId: prepared.messageId,
        sourceRef: prepared.sourceRef,
        idempotencyKey: prepared.idempotencyKey,
        parsedReport: prepared.parsedReport,
        matchedCampaigns: prepared.matchedCampaigns,
        upsert,
        alreadyProcessed: false,
    };
}
