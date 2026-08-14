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
import { ingestWeeklyReportForStore, type WeeklyReportIngestionResult } from './reporting/report-ingestion-service.js';
import type { GmailInboxMessage } from '../integrations/email/gmail-inbox-client.js';

export interface WeeklyProductionWorkflowOptions {
    trigger?: string;
    storeIds?: string[];
    weekStart?: string;
    weekEndExclusive?: string;
    fixtureMessagesByStore?: Record<string, GmailInboxMessage[]>;
    configOverride?: ProductionWorkflowConfig;
    providerOverride?: CampaignAnalysisProvider;
}

export interface WeeklyProductionWorkflowResult {
    success: boolean;
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
        id: stableId('recommendation', `${snapshot.id}|${providerName}|${snapshot.weekStart}|${recommendation.recommendationType}|${recommendation.proposedSetting}`),
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
    storage: ReturnType<typeof createProductionStorage>,
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
    fs.writeFileSync(result.diagnosticsPath, JSON.stringify(result, null, 2));
}

export async function runWeeklyProductionWorkflow(options: WeeklyProductionWorkflowOptions = {}): Promise<WeeklyProductionWorkflowResult> {
    const config = options.configOverride || readProductionWorkflowConfig();
    assertProductionWorkflowConfig(config);
    ensureDir(config.diagnosticsDir);
    const storage = createProductionStorage(config);
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

    try {
        await recordStep(storage, workflowRun.id, 'load_stores', 1, 'success', `Loaded ${stores.length} active stores.`, { stores: stores.map(store => store.id) });

        for (const store of stores) {
            let ingestionResult: WeeklyReportIngestionResult;
            try {
                ingestionResult = await runWithRetry(async () => {
                    return ingestWeeklyReportForStore({
                        storage,
                        config,
                        store,
                        window,
                        messages: options.fixtureMessagesByStore?.[store.id]
                            || (config.reportSource === 'fixture' ? buildFixtureMessages(config, store) : undefined),
                    });
                }, defaultIngestionRetryPolicy(config), async (context) => {
                    await recordStep(storage, workflowRun.id, `ingest_${store.id}`, context.attempt, 'retrying', context.error.message, {
                        nextDelayMs: context.nextDelayMs,
                    }, context.error.message);
                });

                await recordStep(storage, workflowRun.id, `ingest_${store.id}`, 1, 'success', `Ingested ${ingestionResult.matchedCampaigns.length} campaign(s) from ${ingestionResult.sourceRef}.`, {
                    alreadyProcessed: ingestionResult.alreadyProcessed,
                    upsert: ingestionResult.upsert,
                });
            } catch (error) {
                const message = `${store.id}: ${(error as Error).message}`;
                errors.push(message);
                await recordStep(storage, workflowRun.id, `ingest_${store.id}`, 1, 'failed', message, undefined, message);
                continue;
            }

            const currentSnapshots = await storage.listSnapshotsForWeek(store.id, window.weekStart);
            const previousSnapshots = await storage.listMostRecentSnapshotsBeforeWeek(store.id, window.weekStart);
            let recommendationCount = 0;

            for (const snapshot of currentSnapshots) {
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
                    await storage.saveRecommendation(record);
                    recommendationCount += 1;
                } catch (error) {
                    const message = `${store.id}/${snapshot.campaignName}: ${(error as Error).message}`;
                    errors.push(message);
                }
            }

            if (recommendationCount === 0) {
                const message = `${store.id}: no recommendations were produced for week ${window.weekStart}.`;
                errors.push(message);
                await recordStep(storage, workflowRun.id, `analyze_${store.id}`, 1, 'failed', message, undefined, message);
            } else {
                await recordStep(storage, workflowRun.id, `analyze_${store.id}`, 1, 'success', `Persisted ${recommendationCount} recommendation(s).`, {
                    recommendations: recommendationCount,
                });
            }

            storeSummaries.push({
                storeId: store.id,
                reportPath: ingestionResult.reportPath,
                recommendationCount,
                alreadyProcessed: ingestionResult.alreadyProcessed,
            });
        }

        const success = errors.length === 0;
        const result: WeeklyProductionWorkflowResult = {
            success,
            workflowRunId: workflowRun.id,
            weekStart: window.weekStart,
            weekEndExclusive: window.weekEndExclusive,
            reportLabel: window.label,
            summary: success
                ? `Weekly production workflow completed for ${window.label}.`
                : `Weekly production workflow failed for ${window.label}.`,
            diagnosticsPath: path.resolve(config.diagnosticsDir, `${workflowRun.id}.json`),
            stores: storeSummaries,
            errors,
        };
        writeDiagnostics(result);

        if (success) {
            await storage.completeWorkflowRun(workflowRun.id, result.summary, JSON.stringify(result));
        } else {
            await storage.failWorkflowRun(workflowRun.id, errors.join(' | '), JSON.stringify(result));
        }

        return result;
    } finally {
        await storage.close();
    }
}
