import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getCompletedWeeklyReportingWindow, createWeeklyReportingWindow } from '../automation/weekly-reporting-window.js';
import { runWithRetry, type RetryPolicy } from '../automation/retry-policy.js';
import { assertProductionWorkflowConfig, readProductionWorkflowConfig, type ProductionWorkflowConfig } from './config.js';
import { OpenAiCampaignAnalysisProvider } from './analysis/openai-campaign-analysis-provider.js';
import { HybridCampaignAnalysisProvider } from './analysis/hybrid-campaign-analysis-provider.js';
import { RulesCampaignAnalysisProvider } from './analysis/rules-campaign-analysis-provider.js';
import { calculateCampaignMetrics, metricsToSupportingMetrics } from './analysis/campaign-metrics.js';
import type { CampaignAnalysisProvider } from './analysis/provider.js';
import { createProductionStorage } from './storage/storage-factory.js';
import { assertStoresReadyForProductionRun } from './store-catalog.js';
import type {
    CampaignRecommendationRecord,
    ProductionStore,
    SanitizedReviewPackage,
    SupportingMetrics,
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
    fixtureMessages?: GmailInboxMessage[];
    fixtureMessagesByStore?: Record<string, GmailInboxMessage[]>;
    storeOverrides?: Record<string, Partial<ProductionStore>>;
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
        status: 'analysis_complete' | 'report_pending' | 'failed';
        weekStart: string;
        weekEndExclusive: string;
        reportPath: string;
        recommendationCount: number;
        alreadyProcessed: boolean;
        reviewPackagePath: string | null;
    }>;
    errors: string[];
}

export interface PublicWorkflowDiagnostics {
    workflowRunId: string;
    weekStart: string;
    weekEndExclusive: string;
    provider: string;
    ruleVersion: string;
    status: 'success' | 'failed';
    failureCategory: WeeklyProductionWorkflowResult['failureCategory'];
    pendingExternalData: boolean;
    storeCount: number;
    recommendationCount: number;
    alreadyProcessedStoreCount: number;
    stores: Array<{
        storeId: string;
        status: 'analysis_complete' | 'report_pending' | 'failed';
        recommendationCount: number;
        alreadyProcessed: boolean;
    }>;
    sanitizedErrorCategory: 'none' | 'pending_report_delivery' | 'hard_failure';
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
    providerName: CampaignRecommendationRecord['provider'],
    model: string,
    recommendation: Awaited<ReturnType<CampaignAnalysisProvider['analyzeCampaign']>>['recommendations'][number],
): CampaignRecommendationRecord {
    const createdAt = nowIso();
    return {
        id: stableId('recommendation', `${store.id}|${snapshot.weekStart}|${snapshot.campaignId}|${providerName}|${recommendation.ruleId}`),
        storeId: store.id,
        campaignSnapshotId: snapshot.id,
        weekStart: snapshot.weekStart,
        provider: providerName,
        model,
        ruleId: recommendation.ruleId,
        ruleVersion: recommendation.ruleVersion,
        recommendationType: recommendation.recommendationType,
        severity: recommendation.severity,
        detectedCondition: recommendation.detectedCondition,
        currentSetting: recommendation.currentSetting || summarizeCurrentSetting(snapshot),
        proposedSetting: recommendation.proposedSetting,
        supportingMetricsJson: JSON.stringify(recommendation.supportingMetrics),
        expectedBenefit: recommendation.expectedBenefit,
        expectedRoiImpact: recommendation.expectedRoiImpact,
        expectedProfitImpact: recommendation.expectedProfitImpact,
        confidence: recommendation.confidence,
        risk: recommendation.risk,
        reason: recommendation.reason,
        rollbackPlan: recommendation.rollbackPlan,
        humanApprovalRequired: recommendation.humanApprovalRequired,
        enrichmentStatus: recommendation.enrichmentStatus,
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

function buildFixtureMessages(config: ProductionWorkflowConfig): GmailInboxMessage[] {
    const files = fs.existsSync(config.fixtureReportDir)
        ? fs.readdirSync(config.fixtureReportDir)
            .filter(file => /\.(zip|csv|xlsx|xls)$/i.test(file))
            .map(file => path.resolve(config.fixtureReportDir, file))
        : [];

    return files.map((filePath, index) => ({
        uid: index + 1,
        messageId: `fixture-${safeToken(path.basename(filePath))}`,
        subject: `DoorDash marketing report ${path.basename(filePath)}`,
        from: [config.reportAllowedSenders[0] || 'fixtures@example.com'],
        to: ['central-mailbox@example.com'],
        receivedAt: new Date().toISOString(),
        text: 'Fixture report attached.',
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
    if (config.analysisProvider === 'rules') {
        return new RulesCampaignAnalysisProvider(config.rules.ruleVersion);
    }
    if (config.analysisProvider === 'hybrid') {
        return new HybridCampaignAnalysisProvider({
            ruleVersion: config.rules.ruleVersion,
            apiKey: config.openAiApiKey || undefined,
            model: config.openAiModel || undefined,
        });
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

function buildReviewPackage(input: {
    workflowRunId: string;
    config: ProductionWorkflowConfig;
    store: ProductionStore;
    weekStart: string;
    weekEndExclusive: string;
    providerName: CampaignRecommendationRecord['provider'];
    providerModel: string;
    snapshots: WeeklyCampaignSnapshot[];
    previousSnapshots: WeeklyCampaignSnapshot[];
    recommendations: CampaignRecommendationRecord[];
    providerQuestions: string[];
}): SanitizedReviewPackage {
    const previousByCampaign = new Map(
        input.previousSnapshots.map(snapshot => [snapshot.campaignId || snapshot.campaignName, snapshot]),
    );
    const storeTotals = input.snapshots.reduce((accumulator, snapshot) => ({
        spend: accumulator.spend + snapshot.spend,
        sales: accumulator.sales + snapshot.sales,
        orders: accumulator.orders + snapshot.orders,
    }), { spend: 0, sales: 0, orders: 0 });

    const recommendationBySnapshotId = new Map<string, CampaignRecommendationRecord[]>();
    for (const recommendation of input.recommendations) {
        const existing = recommendationBySnapshotId.get(recommendation.campaignSnapshotId) || [];
        existing.push(recommendation);
        recommendationBySnapshotId.set(recommendation.campaignSnapshotId, existing);
    }

    const campaignMetricsTable = input.snapshots.map(snapshot => {
        const metrics = calculateCampaignMetrics({
            snapshot,
            previousSnapshot: previousByCampaign.get(snapshot.campaignId || snapshot.campaignName) || null,
            storeTotals,
        });
        return {
            campaignId: snapshot.campaignId,
            campaignName: snapshot.campaignName,
            campaignType: snapshot.campaignType,
            status: snapshot.status,
            metrics: metricsToSupportingMetrics(metrics),
        };
    });

    const anomalies = input.recommendations.map(recommendation => {
        const snapshot = input.snapshots.find(candidate => candidate.id === recommendation.campaignSnapshotId);
        return {
            campaignId: snapshot?.campaignId || recommendation.campaignSnapshotId,
            campaignName: snapshot?.campaignName || recommendation.campaignSnapshotId,
            severity: recommendation.severity,
            condition: recommendation.detectedCondition,
            metrics: JSON.parse(recommendation.supportingMetricsJson) as SupportingMetrics,
        };
    });

    const recommendations = input.recommendations.map(recommendation => {
        const snapshot = input.snapshots.find(candidate => candidate.id === recommendation.campaignSnapshotId);
        return {
            campaignId: snapshot?.campaignId || recommendation.campaignSnapshotId,
            campaignName: snapshot?.campaignName || recommendation.campaignSnapshotId,
            severity: recommendation.severity,
            detectedCondition: recommendation.detectedCondition,
            supportingMetrics: JSON.parse(recommendation.supportingMetricsJson) as SupportingMetrics,
            recommendedAction: recommendation.proposedSetting,
            expectedBenefit: recommendation.expectedBenefit,
            confidence: recommendation.confidence,
            ruleId: recommendation.ruleId,
            humanApprovalRequired: recommendation.humanApprovalRequired,
            enrichmentStatus: recommendation.enrichmentStatus,
        };
    });

    const executiveSummary = [
        `Store ${input.store.id} generated ${input.recommendations.length} recommendation(s) for ${input.weekStart} to ${input.weekEndExclusive}.`,
        `Provider: ${input.providerName}. Rule version: ${input.config.rules.ruleVersion}.`,
        `Campaigns reviewed: ${input.snapshots.length}.`,
    ].join(' ');

    const promptLines = [
        `Review DoorDash campaign recommendations for ${input.store.name} (${input.store.id}).`,
        `Week: ${input.weekStart} to ${input.weekEndExclusive}.`,
        'Summarize the highest-risk campaigns, challenge any weak assumptions, and propose manual follow-up questions.',
        `Executive summary: ${executiveSummary}`,
        `Recommendations JSON: ${JSON.stringify(recommendations)}`,
    ];

    return {
        id: stableId('review-package', `${input.store.id}|${input.weekStart}|${input.providerName}`),
        workflowRunId: input.workflowRunId,
        storeId: input.store.id,
        storeName: input.store.name,
        weekStart: input.weekStart,
        weekEndExclusive: input.weekEndExclusive,
        provider: input.providerName,
        providerModel: input.providerModel,
        ruleVersion: input.config.rules.ruleVersion,
        createdAt: nowIso(),
        executiveSummary,
        campaignMetricsTable,
        anomalies,
        recommendations,
        questions: input.providerQuestions,
        readyToCopyPrompt: promptLines.join('\n'),
    };
}

function writeReviewPackage(config: ProductionWorkflowConfig, reviewPackage: SanitizedReviewPackage): string {
    if (config.executionEnv === 'production') {
        return '';
    }
    const targetPath = path.resolve(config.diagnosticsDir, `${reviewPackage.id}.review-package.json`);
    fs.writeFileSync(targetPath, JSON.stringify(sanitizeSecrets(reviewPackage), null, 2));
    return targetPath;
}

export function buildPublicWorkflowDiagnostics(
    result: WeeklyProductionWorkflowResult,
    config: ProductionWorkflowConfig,
): PublicWorkflowDiagnostics {
    const recommendationCount = result.stores.reduce((sum, store) => sum + store.recommendationCount, 0);
    const alreadyProcessedStoreCount = result.stores.filter(store => store.alreadyProcessed).length;
    return {
        workflowRunId: result.workflowRunId,
        weekStart: result.weekStart,
        weekEndExclusive: result.weekEndExclusive,
        provider: config.analysisProvider,
        ruleVersion: config.rules.ruleVersion,
        status: result.success ? 'success' : 'failed',
        failureCategory: result.failureCategory,
        pendingExternalData: result.pendingExternalData,
        storeCount: result.stores.length,
        recommendationCount,
        alreadyProcessedStoreCount,
        stores: result.stores.map(store => ({
            storeId: store.storeId,
            status: store.status,
            recommendationCount: store.recommendationCount,
            alreadyProcessed: store.alreadyProcessed,
        })),
        sanitizedErrorCategory: result.success ? 'none' : result.failureCategory,
    };
}

function writeDiagnostics(result: WeeklyProductionWorkflowResult, config: ProductionWorkflowConfig): void {
    ensureDir(path.dirname(result.diagnosticsPath));
    fs.writeFileSync(result.diagnosticsPath, JSON.stringify(buildPublicWorkflowDiagnostics(result, config), null, 2));
}

export async function runWeeklyProductionWorkflow(options: WeeklyProductionWorkflowOptions = {}): Promise<WeeklyProductionWorkflowResult> {
    const config = options.configOverride || readProductionWorkflowConfig();
    assertProductionWorkflowConfig(config);
    ensureDir(config.diagnosticsDir);
    const storage = options.storageOverride || createProductionStorage(config);
    await storage.initialize();
    const provider = options.providerOverride || providerForConfig(config);
    const stores = (await storage.listActiveStores(options.storeIds)).map(store => ({
        ...store,
        ...(options.storeOverrides?.[store.id] || {}),
    }));
    if (config.executionEnv === 'production') {
        assertStoresReadyForProductionRun(stores);
    }
    const storeWindows = new Map(stores.map(store => [
        store.id,
        options.weekStart
            ? createWeeklyReportingWindow(store.timezone, options.weekStart, options.weekEndExclusive)
            : getCompletedWeeklyReportingWindow(store.timezone, options.now),
    ]));
    const canonicalWindow = storeWindows.get(stores[0]?.id || '')
        || (options.weekStart
            ? createWeeklyReportingWindow(config.rules.storeTimeZone, options.weekStart, options.weekEndExclusive)
            : getCompletedWeeklyReportingWindow(config.rules.storeTimeZone, options.now));
    const workflowRun = await storage.createWorkflowRun({
        workflowName: 'doordash-weekly-production',
        trigger: options.trigger || 'manual',
        mode: `${config.reportSource}:${config.analysisProvider}:${config.storageBackend}`,
        timezone: config.schedulerTimeZone,
        weekStart: canonicalWindow.weekStart,
        weekEndExclusive: canonicalWindow.weekEndExclusive,
        metadataJson: JSON.stringify({
            executionEnv: config.executionEnv,
            diagnosticsDir: config.diagnosticsDir,
        }),
    });

    const storeSummaries: WeeklyProductionWorkflowResult['stores'] = [];
    const errors: string[] = [];
    let encounteredPendingExternalData = false;
    let encounteredHardFailure = false;
    const sharedFixtureMessages = options.fixtureMessages
        || (config.reportSource === 'fixture' ? buildFixtureMessages(config) : undefined);

    try {
        await recordStep(storage, workflowRun.id, 'load_stores', 1, 'success', `Loaded ${stores.length} active stores.`, { stores: stores.map(store => store.id) });

        for (const store of stores) {
            const window = storeWindows.get(store.id) || canonicalWindow;
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
                            || sharedFixtureMessages,
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
                storeSummaries.push({
                    storeId: store.id,
                    status: isRetryableReportIngestionError(error) ? 'report_pending' : 'failed',
                    weekStart: window.weekStart,
                    weekEndExclusive: window.weekEndExclusive,
                    reportPath: 'redacted',
                    recommendationCount: 0,
                    alreadyProcessed: false,
                    reviewPackagePath: null,
                });
                continue;
            }

            const previousSnapshots = await storage.listMostRecentSnapshotsBeforeWeek(store.id, window.weekStart);
            const storeTotals = prepared.snapshots.reduce((accumulator, snapshot) => ({
                spend: accumulator.spend + snapshot.spend,
                sales: accumulator.sales + snapshot.sales,
                orders: accumulator.orders + snapshot.orders,
            }), { spend: 0, sales: 0, orders: 0 });
            const recommendations: CampaignRecommendationRecord[] = [];
            let providerQuestions: string[] = [];
            let recommendationFailure: string | null = null;

            for (const snapshot of prepared.snapshots) {
                try {
                    const analysis = await provider.analyzeCampaign({
                        store,
                        snapshot,
                        currentBudget: null,
                        estimatedProfit: estimateProfit(snapshot),
                        estimatedMargin: snapshot.sales > 0 ? Math.round(((estimateProfit(snapshot) / snapshot.sales) * 1000)) / 1000 : 0,
                        previousSnapshot: pickPreviousSnapshot(previousSnapshots, snapshot),
                        rules: {
                            ...config.rules,
                            storeCurrency: store.currency,
                            storeTimeZone: store.timezone,
                        },
                        storeWeeklyTotals: storeTotals,
                    });
                    providerQuestions = [...providerQuestions, ...analysis.questions]
                        .filter((value, index, array) => array.indexOf(value) === index);
                    for (const recommendation of analysis.recommendations) {
                        recommendations.push(buildRecommendationRecord(
                            store,
                            snapshot,
                            analysis.provider,
                            analysis.model,
                            recommendation,
                        ));
                    }
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
                storeSummaries.push({
                    storeId: store.id,
                    status: 'failed',
                    weekStart: window.weekStart,
                    weekEndExclusive: window.weekEndExclusive,
                    reportPath: config.executionEnv === 'production' ? 'redacted' : prepared.sourceRef,
                    recommendationCount: 0,
                    alreadyProcessed: false,
                    reviewPackagePath: null,
                });
                continue;
            }

            try {
                const reviewPackage = buildReviewPackage({
                    workflowRunId: workflowRun.id,
                    config,
                    store,
                    weekStart: window.weekStart,
                    weekEndExclusive: window.weekEndExclusive,
                    providerName: recommendations[0]?.provider || config.analysisProvider,
                    providerModel: recommendations[0]?.model || provider.providerModel,
                    snapshots: prepared.snapshots,
                    previousSnapshots,
                    recommendations,
                    providerQuestions,
                });
                const reviewPackagePath = writeReviewPackage(config, reviewPackage) || null;
                const persisted = await storage.persistStoreBundle({
                    workflowRunId: workflowRun.id,
                    store,
                    snapshots: prepared.snapshots,
                    recommendations,
                    reviewPackage,
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
                    analyzeDetail: `Persisted ${recommendations.length} recommendation(s) and one sanitized review package.`,
                    analyzeMetricsJson: JSON.stringify({ recommendations: recommendations.length, reviewPackageId: reviewPackage.id }),
                });

                storeSummaries.push({
                    storeId: store.id,
                    status: 'analysis_complete',
                    weekStart: window.weekStart,
                    weekEndExclusive: window.weekEndExclusive,
                    reportPath: config.executionEnv === 'production' ? 'redacted' : prepared.sourceRef,
                    recommendationCount: persisted.recommendationCount,
                    alreadyProcessed: persisted.alreadyProcessed,
                    reviewPackagePath,
                });
            } catch (error) {
                const message = `${store.id}: ${sanitizeErrorMessage(error)}`;
                errors.push(message);
                encounteredHardFailure = true;
                await recordStep(storage, workflowRun.id, `ingest_${store.id}`, Math.max(1, ingestAttempt), 'failed', message, undefined, message);
                storeSummaries.push({
                    storeId: store.id,
                    status: 'failed',
                    weekStart: window.weekStart,
                    weekEndExclusive: window.weekEndExclusive,
                    reportPath: config.executionEnv === 'production' ? 'redacted' : prepared.sourceRef,
                    recommendationCount: 0,
                    alreadyProcessed: false,
                    reviewPackagePath: null,
                });
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
            weekStart: canonicalWindow.weekStart,
            weekEndExclusive: canonicalWindow.weekEndExclusive,
            reportLabel: canonicalWindow.label,
            summary: success
                ? `Weekly production workflow completed for ${canonicalWindow.label}.`
                : pendingExternalData
                    ? `Weekly production workflow is waiting for report delivery for ${canonicalWindow.label}.`
                    : `Weekly production workflow failed for ${canonicalWindow.label}.`,
            diagnosticsPath: path.resolve(config.diagnosticsDir, `${workflowRun.id}.json`),
            stores: storeSummaries,
            errors: errors.map(error => sanitizeErrorMessage(error)),
        };
        writeDiagnostics(result, config);

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
