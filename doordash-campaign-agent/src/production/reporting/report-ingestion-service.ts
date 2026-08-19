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

export type StoreReportDiscoveryStatus =
    | 'ready'
    | 'report_pending'
    | 'invalid_report'
    | 'store_id_mismatch'
    | 'duplicate_report'
    | 'imap_failure'
    | 'analysis_complete'
    | 'failed';

export interface StoreReportDiscoveryResult {
    storeId: string;
    status: StoreReportDiscoveryStatus;
    detail: string;
    prepared: PreparedWeeklyReportIngestion | null;
    error: Error | null;
    weekStart: string;
    weekEndExclusive: string;
}

export interface MultiStoreReportDiscoveryResult {
    enabledStoreCount: number;
    reportFoundCount: number;
    missingReportCount: number;
    rejectedCandidateCount: number;
    rejectionCategories: Record<string, number>;
    stores: StoreReportDiscoveryResult[];
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

const INTERNAL_APPROVAL_SUBJECT_MARKERS = [
    'doordash approval needed',
];

const INTERNAL_APPROVAL_TEXT_MARKERS = [
    'dd approve',
    'dd reject',
    'approval request',
];

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

function fileNameMentionsStore(fileName: string, store: ProductionStore): boolean {
    const normalized = normalizeValue(fileName);
    const tokens = [
        store.storeSlug,
        store.displayName,
        store.doorDashStoreId,
        ...store.reportFilenameAliases,
    ].map(normalizeValue).filter(Boolean);
    return tokens.some(token => normalized.includes(token));
}

function messageMentionsStore(message: GmailInboxMessage, store: ProductionStore): boolean {
    const subject = normalizeValue(message.subject);
    const body = normalizeValue(message.text);
    const tokens = [
        store.storeSlug,
        store.displayName,
        store.doorDashStoreId,
        ...store.reportSubjectAliases,
        ...store.reportFilenameAliases,
    ].map(normalizeValue).filter(Boolean);
    if (tokens.some(token => subject.includes(token) || body.includes(token))) {
        return true;
    }
    return message.attachments.some(attachment => fileNameMentionsStore(attachment.filename, store));
}

function messageIsInternalApproval(message: GmailInboxMessage): boolean {
    const subject = normalizeValue(message.subject);
    const body = normalizeValue(message.text);
    if (INTERNAL_APPROVAL_SUBJECT_MARKERS.some(marker => subject.includes(marker))) {
        return true;
    }
    if (INTERNAL_APPROVAL_TEXT_MARKERS.some(marker => body.includes(marker) || subject.includes(marker))) {
        return true;
    }
    return false;
}

function messageLooksLikePotentialReport(message: GmailInboxMessage, config: ProductionWorkflowConfig): boolean {
    if (messageIsInternalApproval(message)) {
        return false;
    }
    try {
        if (findSupportedAttachment(message)) {
            return true;
        }
    } catch {
        return true;
    }
    if (findOfficialExportLink(message)) {
        return true;
    }
    const subject = normalizeValue(message.subject);
    return config.reportSubjectIncludes.some(token => subject.includes(normalizeValue(token)));
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REPORT_LINK_TIMEOUT_MS);

    try {
        const response = await fetch(targetUrl, { signal: controller.signal });
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

function candidateRejectionCategory(error: unknown): string {
    if (error instanceof ReportStoreMismatchError) return 'store_id_mismatch';
    if (error instanceof UnsupportedReportArtifactError) return 'invalid_report';
    if (error instanceof ReportAuthenticationError) return 'imap_failure';
    if (error instanceof ReportInboxUnavailableError) return 'imap_failure';
    return 'failed';
}

function missingReportResult(
    config: ProductionWorkflowConfig,
    store: ProductionStore,
    window: WeeklyWindow,
    now: Date,
): StoreReportDiscoveryResult {
    const deliveryDeadline = new Date(weeklyProductionRunScheduledAtUtc(window).getTime() + (config.reportDeliveryGraceHours * 60 * 60 * 1000));
    if (now.getTime() > deliveryDeadline.getTime()) {
        const error = new ReportDeliveryWindowExpiredError(
            `DoorDash report delivery window expired for store ${store.storeSlug} and week ${window.weekStart}. No matching report arrived before ${deliveryDeadline.toISOString()}.`,
        );
        return {
            storeId: store.storeSlug,
            status: 'failed',
            detail: error.message,
            prepared: null,
            error,
            weekStart: window.weekStart,
            weekEndExclusive: window.weekEndExclusive,
        };
    }

    const error = new ReportNotReadyError(
        `DoorDash report has not arrived yet for store ${store.storeSlug} and week ${window.weekStart}. The workflow will retry until ${deliveryDeadline.toISOString()}.`,
    );
    return {
        storeId: store.storeSlug,
        status: 'report_pending',
        detail: error.message,
        prepared: null,
        error,
        weekStart: window.weekStart,
        weekEndExclusive: window.weekEndExclusive,
    };
}

export async function discoverWeeklyReportsForStores(input: {
    config: ProductionWorkflowConfig;
    storeWindows: Array<{ store: ProductionStore; window: WeeklyWindow }>;
    messages?: GmailInboxMessage[];
    now?: Date;
}): Promise<MultiStoreReportDiscoveryResult> {
    const now = input.now || new Date();
    const storeById = new Map(input.storeWindows.map(item => [item.store.storeSlug, item]));
    const discoveries = new Map<string, StoreReportDiscoveryResult>();
    const assigned = new Map<string, PreparedWeeklyReportIngestion>();
    const rejectionCategories: Record<string, number> = {};
    let rejectedCandidateCount = 0;

    const reject = (category: string): void => {
        rejectedCandidateCount += 1;
        rejectionCategories[category] = (rejectionCategories[category] || 0) + 1;
    };

    let messages: GmailInboxMessage[];
    try {
        messages = input.messages || await locateCandidateMessages(input.config);
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'IMAP mailbox connection failed.';
        return {
            enabledStoreCount: input.storeWindows.length,
            reportFoundCount: 0,
            missingReportCount: input.storeWindows.length,
            rejectedCandidateCount: 0,
            rejectionCategories: {},
            stores: input.storeWindows.map(({ store, window }) => ({
                storeId: store.storeSlug,
                status: 'imap_failure',
                detail,
                prepared: null,
                error: error instanceof Error ? error : new ReportInboxUnavailableError(detail),
                weekStart: window.weekStart,
                weekEndExclusive: window.weekEndExclusive,
            })),
        };
    }

    const sortedMessages = [...messages].sort((left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime());
    for (const message of sortedMessages) {
        if (messageIsInternalApproval(message)) {
            reject('internal_approval');
            continue;
        }
        if (!messageLooksLikePotentialReport(message, input.config)) {
            reject('unsupported_candidate');
            continue;
        }

        try {
            const artifact = await resolveReportArtifact(message, input.config);
            const parsedReport = parseMarketingReportFile(artifact.filePath);
            const matches: Array<{ store: ProductionStore; window: WeeklyWindow; campaigns: ParsedMarketingCampaign[] }> = [];
            const validationErrors = new Map<string, Error>();

            for (const { store, window } of input.storeWindows) {
                try {
                    const campaigns = validateParsedReport(parsedReport, store, window);
                    matches.push({ store, window, campaigns });
                } catch (error) {
                    if (error instanceof Error) {
                        validationErrors.set(store.storeSlug, error);
                    }
                    continue;
                }
            }

            if (matches.length === 0) {
                const mentionedStores = input.storeWindows.filter(item => messageMentionsStore(message, item.store));
                if (mentionedStores.length === 1) {
                    const mentioned = mentionedStores[0];
                    const validationError = validationErrors.get(mentioned.store.storeSlug);
                    const status = validationError instanceof ReportStoreMismatchError ? 'store_id_mismatch' : 'invalid_report';
                    discoveries.set(mentioned.store.storeSlug, {
                        storeId: mentioned.store.storeSlug,
                        status,
                        detail: validationError?.message || `Supported report candidate for ${mentioned.store.storeSlug} did not contain a valid completed-week export for ${mentioned.window.weekStart}.`,
                        prepared: null,
                        error: validationError || new UnsupportedReportArtifactError(`Supported report candidate for ${mentioned.store.storeSlug} did not validate.`),
                        weekStart: mentioned.window.weekStart,
                        weekEndExclusive: mentioned.window.weekEndExclusive,
                    });
                }
                reject('invalid_report');
                continue;
            }

            if (matches.length > 1) {
                for (const match of matches) {
                    discoveries.set(match.store.storeSlug, {
                        storeId: match.store.storeSlug,
                        status: 'store_id_mismatch',
                        detail: `One report candidate ambiguously matched multiple configured stores for week ${match.window.weekStart}.`,
                        prepared: null,
                        error: new ReportStoreMismatchError('Ambiguous multi-store report candidate.'),
                        weekStart: match.window.weekStart,
                        weekEndExclusive: match.window.weekEndExclusive,
                    });
                }
                reject('store_id_mismatch');
                continue;
            }

            const match = matches[0];
            const prepared: PreparedWeeklyReportIngestion = {
                storeId: match.store.storeSlug,
                reportPath: artifact.filePath,
                messageId: message.messageId,
                sourceRef: path.basename(artifact.filePath),
                idempotencyKey: buildIdempotencyKey(message.messageId, artifact.hash, match.store.storeSlug, match.window.weekStart),
                parsedReport,
                matchedCampaigns: match.campaigns,
                snapshots: toWeeklySnapshots(match.store, match.window, parsedReport, match.campaigns, path.basename(artifact.filePath)),
                attachmentHash: artifact.hash,
            };

            if (assigned.has(match.store.storeSlug)) {
                assigned.delete(match.store.storeSlug);
                discoveries.set(match.store.storeSlug, {
                    storeId: match.store.storeSlug,
                    status: 'duplicate_report',
                    detail: `Multiple completed-week report candidates were found for ${match.store.storeSlug}.`,
                    prepared: null,
                    error: new UnsupportedReportArtifactError(`Duplicate report candidates for ${match.store.storeSlug}.`),
                    weekStart: match.window.weekStart,
                    weekEndExclusive: match.window.weekEndExclusive,
                });
                reject('duplicate_report');
                continue;
            }

            assigned.set(match.store.storeSlug, prepared);
            discoveries.set(match.store.storeSlug, {
                storeId: match.store.storeSlug,
                status: 'ready',
                detail: `Completed-week report is ready for ${match.store.storeSlug}.`,
                prepared,
                error: null,
                weekStart: match.window.weekStart,
                weekEndExclusive: match.window.weekEndExclusive,
            });
        } catch (error) {
            const mentionedStores = input.storeWindows.filter(item => messageMentionsStore(message, item.store));
            if (mentionedStores.length === 1) {
                const mentioned = mentionedStores[0];
                discoveries.set(mentioned.store.storeSlug, {
                    storeId: mentioned.store.storeSlug,
                    status: candidateRejectionCategory(error) === 'store_id_mismatch' ? 'store_id_mismatch' : 'invalid_report',
                    detail: error instanceof Error ? error.message : `Supported report candidate for ${mentioned.store.storeSlug} did not validate.`,
                    prepared: null,
                    error: error instanceof Error ? error : new UnsupportedReportArtifactError(`Supported report candidate for ${mentioned.store.storeSlug} did not validate.`),
                    weekStart: mentioned.window.weekStart,
                    weekEndExclusive: mentioned.window.weekEndExclusive,
                });
            }
            reject(candidateRejectionCategory(error));
        }
    }

    const stores = input.storeWindows.map(({ store, window }) => {
        const existing = discoveries.get(store.storeSlug);
        if (existing) {
            return existing;
        }
        return missingReportResult(input.config, store, window, now);
    });

    return {
        enabledStoreCount: input.storeWindows.length,
        reportFoundCount: stores.filter(store => store.status === 'ready').length,
        missingReportCount: stores.filter(store => store.status === 'report_pending' || store.status === 'failed').length,
        rejectedCandidateCount,
        rejectionCategories,
        stores,
    };
}

export async function prepareWeeklyReportForStore(input: {
    config: ProductionWorkflowConfig;
    store: ProductionStore;
    window: WeeklyWindow;
    messages?: GmailInboxMessage[];
    now?: Date;
}): Promise<PreparedWeeklyReportIngestion> {
    const discovery = await discoverWeeklyReportsForStores({
        config: input.config,
        storeWindows: [{ store: input.store, window: input.window }],
        messages: input.messages,
        now: input.now,
    });
    const result = discovery.stores[0];
    if (result?.status === 'ready' && result.prepared) {
        return result.prepared;
    }
    if (result?.error) {
        throw result.error;
    }
    throw new Error(`No usable report artifact was found for store ${input.store.id}.`);
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
