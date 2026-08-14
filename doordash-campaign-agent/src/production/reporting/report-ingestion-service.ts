import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GmailInboxClient, type GmailInboxMessage } from '../../integrations/email/gmail-inbox-client.js';
import { parseMarketingReportFile, type ParsedMarketingCampaign, type ParsedMarketingReport } from '../../reporting/marketing-report-parser.js';
import { campaignMatchesStore } from '../../reporting/marketing-report-store-match.js';
import type { ProductionWorkflowConfig } from '../config.js';
import type { IngestionIdempotencyRecord, ProductionStore, WeeklyCampaignSnapshot } from '../types.js';
import type { ProductionStorage, SnapshotUpsertResult } from '../storage/production-storage.js';

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
    const dir = path.resolve(config.diagnosticsDir, 'downloaded-reports');
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

function findSupportedAttachment(message: GmailInboxMessage): { filename: string; content: Buffer } | null {
    const attachment = message.attachments.find(item => /\.(zip|csv|xlsx|xls)$/i.test(item.filename));
    return attachment ? { filename: attachment.filename, content: attachment.content } : null;
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

    const response = await fetch(targetUrl, { headers });
    if (!response.ok) {
        throw new Error(`Official report link download failed with HTTP ${response.status}.`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);
    const extension = path.extname(new URL(targetUrl).pathname) || '.bin';
    const filePath = path.resolve(attachmentDirectory(config), `${safeFileName(messageId)}${extension}`);
    fs.writeFileSync(filePath, content);
    return {
        filePath,
        hash: crypto.createHash('sha256').update(content).digest('hex'),
    };
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

function buildSnapshotId(storeId: string, weekStart: string, campaign: ParsedMarketingCampaign, sourceRef: string): string {
    return crypto
        .createHash('sha256')
        .update([storeId, weekStart, campaign.campaignId, campaign.campaignName, sourceRef].join('|'))
        .digest('hex')
        .slice(0, 24);
}

function validateParsedReport(parsedReport: ParsedMarketingReport, store: ProductionStore, window: WeeklyWindow): ParsedMarketingCampaign[] {
    if (parsedReport.campaigns.length === 0) {
        throw new Error(`Marketing report ${path.basename(parsedReport.reportPath)} contains no campaign rows.`);
    }
    if (!parsedReport.reportTypes.length) {
        throw new Error(`Marketing report ${path.basename(parsedReport.reportPath)} does not declare a supported report type.`);
    }

    const expectedEndInclusive = shiftIsoDate(window.weekEndExclusive, -1);
    const allowedEndDates = new Set([expectedEndInclusive, window.weekEndExclusive]);
    if (parsedReport.observedDateStart !== window.weekStart || !allowedEndDates.has(parsedReport.observedDateEnd || '')) {
        throw new Error(
            `Marketing report ${path.basename(parsedReport.reportPath)} is stale or partial. Expected ${window.weekStart} to ${expectedEndInclusive} (or ${window.weekEndExclusive} when DoorDash includes the boundary day), got ${parsedReport.observedDateStart || 'n/a'} to ${parsedReport.observedDateEnd || 'n/a'}.`,
        );
    }

    const matchedCampaigns = parsedReport.campaigns.filter(campaign => campaignMatchesStore(campaign, store));
    if (matchedCampaigns.length === 0) {
        throw new Error(`Marketing report ${path.basename(parsedReport.reportPath)} does not match store ${store.id}.`);
    }

    if (store.doorDashAccountId) {
        const invalidStoreIds = matchedCampaigns
            .map(campaign => campaign.storeId)
            .filter(storeId => normalizeValue(storeId) !== normalizeValue(store.doorDashAccountId));
        if (invalidStoreIds.length > 0) {
            throw new Error(`Marketing report ${path.basename(parsedReport.reportPath)} failed Store ID validation for ${store.id}. Expected ${store.doorDashAccountId}.`);
        }
    }

    for (const campaign of matchedCampaigns) {
        if (campaign.rowCount <= 0) {
            throw new Error(`Marketing report ${path.basename(parsedReport.reportPath)} contains an empty campaign for ${campaign.campaignName}.`);
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
            reportPath: parsedReport.reportPath,
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

    throw new Error(`Message ${message.messageId} does not contain a supported report attachment or official export link.`);
}

async function locateCandidateMessages(config: ProductionWorkflowConfig): Promise<GmailInboxMessage[]> {
    const client = new GmailInboxClient();
    const messages = await client.fetchRecentMessages(config.reportLookbackHours, config.reportInboxLabel);
    return messages.filter(message => messageFromAllowedSender(message, config));
}

export async function ingestWeeklyReportForStore(input: {
    storage: ProductionStorage;
    config: ProductionWorkflowConfig;
    store: ProductionStore;
    window: WeeklyWindow;
    messages?: GmailInboxMessage[];
}): Promise<WeeklyReportIngestionResult> {
    const messages = input.messages || await locateCandidateMessages(input.config);
    const candidates = messages.filter(message => subjectLooksRelevant(message, input.store, input.config));

    if (candidates.length === 0) {
        throw new Error(`No report email matched sender/subject filters for store ${input.store.id} and week ${input.window.weekStart}.`);
    }

    let lastError: Error | null = null;
    for (const message of candidates) {
        try {
            const artifact = await resolveReportArtifact(message, input.config);
            const parsedReport = parseMarketingReportFile(artifact.filePath);
            const matchedCampaigns = validateParsedReport(parsedReport, input.store, input.window);
            const idempotencyKey = buildIdempotencyKey(message.messageId, artifact.hash, input.store.id, input.window.weekStart);
            const alreadyProcessed = await input.storage.hasIngestionRecord(idempotencyKey);
            const sourceRef = path.basename(artifact.filePath);

            if (alreadyProcessed) {
                return {
                    storeId: input.store.id,
                    reportPath: artifact.filePath,
                    messageId: message.messageId,
                    sourceRef,
                    idempotencyKey,
                    parsedReport,
                    matchedCampaigns,
                    upsert: { created: 0, updated: 0, unchanged: matchedCampaigns.length },
                    alreadyProcessed: true,
                };
            }

            const snapshots = toWeeklySnapshots(input.store, input.window, parsedReport, matchedCampaigns, sourceRef);
            const upsert = await input.storage.upsertSnapshots(snapshots);
            const record: IngestionIdempotencyRecord = {
                idempotencyKey,
                messageId: message.messageId,
                attachmentHash: artifact.hash,
                storeId: input.store.id,
                weekStart: input.window.weekStart,
                sourceRef,
                createdAt: new Date().toISOString(),
            };
            await input.storage.saveIngestionRecord(record);

            return {
                storeId: input.store.id,
                reportPath: artifact.filePath,
                messageId: message.messageId,
                sourceRef,
                idempotencyKey,
                parsedReport,
                matchedCampaigns,
                upsert,
                alreadyProcessed: false,
            };
        } catch (error) {
            lastError = error as Error;
        }
    }

    throw lastError || new Error(`No usable report artifact was found for store ${input.store.id}.`);
}
