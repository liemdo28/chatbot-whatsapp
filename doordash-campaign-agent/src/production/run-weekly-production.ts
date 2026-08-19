import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getCompletedWeeklyReportingWindow, createWeeklyReportingWindow } from '../automation/weekly-reporting-window.js';
import { runWithRetry, type RetryPolicy } from '../automation/retry-policy.js';
import { assertProductionWorkflowConfig, readProductionWorkflowConfig, type ProductionWorkflowConfig } from './config.js';
import { OpenAiCampaignAnalysisProvider } from './analysis/openai-campaign-analysis-provider.js';
import { BrowserCampaignAnalysisProvider } from './analysis/browser-campaign-analysis-provider.js';
import type { CampaignAnalysisProvider } from './analysis/provider.js';
import { createProductionStorage } from './storage/storage-factory.js';
import type {
    CampaignRecommendationRecord,
    ProductionStore,
    WeeklyCampaignSnapshot,
    WorkflowStepStatus,
} from './types.js';
import { prepareWeeklyReportForStore, type PreparedWeeklyReportIngestion } from './reporting/report-ingestion-service.js';
import { isRetryableReportIngestionError } from './reporting/report-ingestion-errors.js';
import type { GmailInboxMessage } from '../integrations/email/gmail-inbox-client.js';
import type { ProductionStorage } from './storage/production-storage.js';
import { sanitizeErrorMessage, sanitizeSecrets } from './security/error-sanitizer.js';

export interface WeeklyProductionWorkflowOptions {
    trigger?: string;
    storeIds?: string[];
    weekStart?: string;
    weekEndExclusive?: string;
    fixtureMessagesByStore?: Record<string, GmailInboxMessage[]>;
    configOverride?: ProductionWorkflowConfig;
    providerOverride?: CampaignAnalysisProvider;
    storageOverride?: ProductionStorage;
    now?: Date;
}

export interface WeeklyProductionWorkflowResult {
    success: boolean;
    pendingExternalData: boolean;
    failureCategory: 'none' | 'pending_report_delivery' | 'hard_failure';
    workflowRunId: string;
    weekStart: string;
    weekEndExclusive: string;
    reportLabel: string;
    summary: string;
    diagnosticsPath: string;
    stores: Array<{
        storeId: string;
        reportPath: string;
        recommendationCount: number;
        alreadyProcessed: boolean;
    }>;
    errors: string[];
}

function nowIso(): string {
    return new Date().toISOString();
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function stableId(prefix: string, input: string): string {
    return `${prefix}-${crypto.createHash('sha256').update(input).digest('hex').slice(0, 24)}`;
}

function estimateProfit(snapshot: WeeklyCampaignSnapshot): number {
    return Math.round(((snapshot.sales * 0.2) - snapshot.spend) * 100) / 100;
}

function summarizeCurrentSetting(snapshot: WeeklyCampaignSnapshot): string {
    return [
        snapshot.status,
        `Spend $${snapshot.spend.toFixed(2)}`,
        `Sales $${snapshot.sales.toFixed(2)}`,
        `ROAS ${snapshot.roas.toFixed(2)}x`,
    ].join(' | ');
}

function buildRecommendationRecord(
    store: ProductionStore,
    snapshot: WeeklyCampaignSnapshot,
    providerName: string,
    model: string,
    recommendation: Awaited<ReturnType<CampaignAnalysisProvider['analyzeCampaign']>>,
): CampaignRecommendationRecord {
    const createdAt = nowIso();
    return {
        id: stableId('recommendation', `${store.id}|${snapshot.weekStart}|${snapshot.campaignId}|${providerName}|${recommendation.recommendationType}|${recommendation.proposedSetting}`),
        storeId: store.id,
        campaignSnapshotId: snapshot.id,
        weekStart: snapshot.weekStart,
        provider: providerName === 'browser' ? 'browser' : 'openai',
        model,
        recommendationType: recommendation.recommendationType,
        currentSetting: recommendation.currentSetting || summarizeCurrentSetting(snapshot),
        proposedSetting: recommendation.proposedSetting,
        expectedRoiImpact: recommendation.expectedRoiImpact,
        expectedProfitImpact: recommendation.expectedProfitImpact,
        confidence: recommendation.confidence,
        risk: recommendation.risk,
        reason: recommendation.reason,
        rollbackPlan: recommendation.rollbackPlan,
        rawResponseJson: JSON.stringify(recommendation),
        status: 'pending',
        createdAt,
    };
}

function defaultIngestionRetryPolicy(config: ProductionWorkflowConfig): RetryPolicy {
    return {
        attempts: Math.max(1, config.reportRetryAttempts),
        initialDelayMs: Math.max(0, config.reportRetryDelayMs),
        backoffMultiplier: 2,
        maxDelayMs: Math.max(config.reportRetryDelayMs, 15000),
        shouldRetry: (error) => isRetryableReportIngestionError(error),
    };
}

function buildFixtureMessages(
    config: ProductionWorkflowConfig,
    store: ProductionStore,
): GmailInboxMessage[] {
    const files = fs.existsSync(config.fixtureReportDir)
        ? fs.readdirSync(config.fixtureReportDir)
            .filter(file => /\.(zip|csv|xlsx|xls)$/i.test(file))
            .map(file => path.resolve(config.fixtureReportDir, file))
        : [];

    return files.map((filePath, index) => ({
        uid: index + 1,
        messageId: `fixture-${safeToken(path.basename(filePath))}`,
        subject: `DoorDash marketing report ${store.name} ${path.basename(filePath)}`,
        from: [config.reportAllowedSenders[0] || 'fixtures@example.com'],
        to: [store.email],
        receivedAt: new Date().toISOString(),
        text: `Fixture report for ${store.name}.`,
        attachments: [{
            filename: path.basename(filePath),
            contentType: 'application/octet-stream',
            content: fs.readFileSync(filePath),
        }],
    }));
}

function safeToken(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
}

function providerForConfig(config: ProductionWorkflowConfig): CampaignAnalysisProvider {
    if (config.analysisProvider === 'browser') {
        return new BrowserCampaignAnalysisProvider();
    }
    return new OpenAiCampaignAnalysisProvider({
        apiKey: config.openAiApiKey,
        model: config.openAiModel,
    });
}

async function recordStep(
    storage: ProductionStorage,
    runId: string,
    stepKey: string,
    attempt: number,
    status: WorkflowStepStatus,
    detail: string,
    metrics?: unknown,
    errorMessage?: string,
): Promise<void> {
    const timestamp = nowIso();
    await storage.recordWorkflowStep({
        runId,
        stepKey,
        attempt,
        status,
        startedAt: timestamp,
        completedAt: timestamp,
        detail,
        errorMessage: errorMessage || null,
        metricsJson: metrics === undefined ? null : JSON.stringify(metrics),
    });
}

function pickPreviousSnapshot(previousSnapshots: WeeklyCampaignSnapshot[], current: WeeklyCampaignSnapshot): WeeklyCampaignSnapshot | null {
    return previousSnapshots.find(snapshot => snapshot.campaignId === current.campaignId || snapshot.campaignName === current.campaignName) || null;
}

function writeDiagnostics(result: WeeklyProductionWorkflowResult): void {
    ensureDir(path.dirname(result.diagnosticsPath));
    fs.writeFileSync(result.diagnosticsPath, JSON.stringify(sanitizeSecrets(result), null, 2));
}

export async function runWeeklyProductionWorkflow(options: WeeklyProductionWorkflowOptions = {}): Promise<WeeklyProductionWorkflowResult> {
    const config = options.configOverride || readProductionWorkflowConfig();
    assertProductionWorkflowConfig(config);
    ensureDir(config.diagnosticsDir);
    const storage = options.storageOverride || createProductionStorage(config);
    await storage.initialize();

    const window = options.weekStart
        ? createWeeklyReportingWindow(config.schedulerTimeZone, options.weekStart, options.weekEndExclusive)
        : getCompletedWeeklyReportingWindow(config.schedulerTimeZone);
    const provider = options.providerOverride || providerForConfig(config);
    const workflowRun = await storage.createWorkflowRun({
        workflowName: 'doordash-weekly-production',
        trigger: options.trigger || 'manual',
        mode: `${config.reportSource}:${config.analysisProvider}:${config.storageBackend}`,
        timezone: config.schedulerTimeZone,
        weekStart: window.weekStart,
        weekEndExclusive: window.weekEndExclusive,
        metadataJson: JSON.stringify({
            executionEnv: config.executionEnv,
            diagnosticsDir: config.diagnosticsDir,
        }),
    });

    const stores = await storage.listActiveStores(options.storeIds);
    const storeSummaries: WeeklyProductionWorkflowResult['stores'] = [];
    const errors: string[] = [];
    let encounteredPendingExternalData = false;
    let encounteredHardFailure = false;

    try {
        await recordStep(storage, workflowRun.id, 'load_stores', 1, 'success', `Loaded ${stores.length} active stores.`, { stores: stores.map(store => store.id) });

        for (const store of stores) {
            let prepared: PreparedWeeklyReportIngestion;
            let ingestAttempt = 0;
            try {
                prepared = await runWithRetry(async () => {
                    ingestAttempt += 1;
                    return prepareWeeklyReportForStore({
                        config,
                        store,
                        window,
                        messages: options.fixtureMessagesByStore?.[store.id]
                            || (config.reportSource === 'fixture' ? buildFixtureMessages(config, store) : undefined),
                        now: options.now,
                    });
                }, defaultIngestionRetryPolicy(config), async (context) => {
                    await recordStep(storage, workflowRun.id, `ingest_${store.id}`, context.attempt, 'retrying', context.error.message, {
                        nextDelayMs: context.nextDelayMs,
                    }, context.error.message);
                });

            } catch (error) {
                const message = `${store.id}: ${sanitizeErrorMessage(error)}`;
                errors.push(message);
                if (isRetryableReportIngestionError(error)) {
                    encounteredPendingExternalData = true;
                } else {
                    encounteredHardFailure = true;
                }
                await recordStep(storage, workflowRun.id, `ingest_${store.id}`, 1, 'failed', message, undefined, message);
                continue;
            }

            const previousSnapshots = await storage.listMostRecentSnapshotsBeforeWeek(store.id, window.weekStart);
            const recommendations: CampaignRecommendationRecord[] = [];
            let recommendationFailure: string | null = null;

            for (const snapshot of prepared.snapshots) {
                try {
                    const recommendation = await provider.analyzeCampaign({
                        store,
                        snapshot,
                        currentBudget: null,
                        estimatedProfit: estimateProfit(snapshot),
                        estimatedMargin: snapshot.sales > 0 ? Math.round(((estimateProfit(snapshot) / snapshot.sales) * 1000)) / 1000 : 0,
                        previousSnapshot: pickPreviousSnapshot(previousSnapshots, snapshot),
                    });
                    const record = buildRecommendationRecord(
                        store,
                        snapshot,
                        provider.providerName,
                        config.openAiModel || 'development-browser',
                        recommendation,
                    );
                    recommendations.push(record);
                } catch (error) {
                    recommendationFailure = `${store.id}/${snapshot.campaignName}: ${sanitizeErrorMessage(error)}`;
                    break;
                }
            }

            if (!recommendationFailure && recommendations.length === 0) {
                recommendationFailure = `${store.id}: no recommendations were produced for week ${window.weekStart}.`;
            }

            if (recommendationFailure) {
                const message = recommendationFailure;
                errors.push(message);
                encounteredHardFailure = true;
                await recordStep(storage, workflowRun.id, `analyze_${store.id}`, 1, 'failed', message, undefined, message);
                continue;
            }

            try {
                const persisted = await storage.persistStoreBundle({
                    workflowRunId: workflowRun.id,
                    store,
                    snapshots: prepared.snapshots,
                    recommendations,
                    ingestionRecord: {
                        idempotencyKey: prepared.idempotencyKey,
                        messageId: prepared.messageId,
                        attachmentHash: prepared.attachmentHash,
                        storeId: store.id,
                        weekStart: window.weekStart,
                        sourceRef: prepared.sourceRef,
                        createdAt: new Date().toISOString(),
                    },
                    ingestAttempt: Math.max(1, ingestAttempt),
                    ingestDetail: `Ingested ${prepared.matchedCampaigns.length} campaign(s) from ${prepared.sourceRef}.`,
                    ingestMetricsJson: JSON.stringify({
                        matchedCampaigns: prepared.matchedCampaigns.length,
                        snapshotsCreated: prepared.snapshots.length,
                    }),
                    analyzeAttempt: 1,
                    analyzeDetail: `Persisted ${recommendations.length} recommendation(s).`,
                    analyzeMetricsJson: JSON.stringify({ recommendations: recommendations.length }),
                });

                storeSummaries.push({
                    storeId: store.id,
                    reportPath: prepared.sourceRef,
                    recommendationCount: persisted.recommendationCount,
                    alreadyProcessed: persisted.alreadyProcessed,
                });
            } catch (error) {
                const message = `${store.id}: ${sanitizeErrorMessage(error)}`;
                errors.push(message);
                encounteredHardFailure = true;
                await recordStep(storage, workflowRun.id, `ingest_${store.id}`, Math.max(1, ingestAttempt), 'failed', message, undefined, message);
                continue;
            }

            const recommendationCount = recommendations.length;
            if (recommendationCount === 0) {
                const message = `${store.id}: no recommendations were produced for week ${window.weekStart}.`;
                errors.push(message);
                encounteredHardFailure = true;
            }
        }

        const success = errors.length === 0;
        const pendingExternalData = !success && encounteredPendingExternalData && !encounteredHardFailure;
        const result: WeeklyProductionWorkflowResult = {
            success,
            pendingExternalData,
            failureCategory: success ? 'none' : pendingExternalData ? 'pending_report_delivery' : 'hard_failure',
            workflowRunId: workflowRun.id,
            weekStart: window.weekStart,
            weekEndExclusive: window.weekEndExclusive,
            reportLabel: window.label,
            summary: success
                ? `Weekly production workflow completed for ${window.label}.`
                : pendingExternalData
                    ? `Weekly production workflow is waiting for report delivery for ${window.label}.`
                    : `Weekly production workflow failed for ${window.label}.`,
            diagnosticsPath: path.resolve(config.diagnosticsDir, `${workflowRun.id}.json`),
            stores: storeSummaries,
            errors: errors.map(error => sanitizeErrorMessage(error)),
        };
        writeDiagnostics(result);

        if (success) {
            await storage.completeWorkflowRun(workflowRun.id, sanitizeErrorMessage(result.summary), JSON.stringify(result));
        } else {
            await storage.failWorkflowRun(workflowRun.id, errors.map(error => sanitizeErrorMessage(error)).join(' | '), JSON.stringify(result));
        }

        return result;
    } finally {
        await storage.close();
    }
}
