export type AnalysisProviderName = 'rules' | 'openai' | 'hybrid';
export type ReportSourceName = 'imap' | 'fixture';
export type StorageBackendName = 'sqlite' | 'postgres';
export type WorkflowStepStatus = 'running' | 'success' | 'failed' | 'retrying' | 'skipped';
export type RecommendationAction = 'INCREASE' | 'DECREASE' | 'PAUSE' | 'RESUME' | 'TEST' | 'KEEP' | 'REQUEST_MORE_DATA';
export type RecommendationRisk = 'low' | 'medium' | 'high';
export type RecommendationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type RecommendationEnrichmentStatus = 'not_applicable' | 'enriched' | 'skipped';

export interface RulesEngineConfig {
    ruleVersion: string;
    minAcceptableRoas: number;
    maxAcceptableCpa: number;
    minimumSpendForJudgement: number;
    minimumImpressionsForConfidence: number;
    minimumClicksForConfidence: number;
    deteriorationThresholdPct: number;
    budgetIncreaseCeilingPct: number;
    storeCurrency: string;
    storeTimeZone: string;
}

export type SupportingMetricValue = number | string | boolean | null;
export type SupportingMetrics = Record<string, SupportingMetricValue>;

export interface ProductionStore {
    id: string;
    name: string;
    email: string;
    doorDashAccountId: string | null;
    active: boolean;
}

export interface WeeklyCampaignSnapshot {
    id: string;
    storeId: string;
    campaignId: string;
    campaignName: string;
    campaignType: string;
    status: string;
    weekStart: string;
    weekEndExclusive: string;
    snapshotSource: string;
    sourceRef: string;
    batchId: string;
    reportStartDate: string;
    reportEndDate: string;
    observedDateStart: string;
    observedDateEnd: string;
    orders: number;
    sales: number;
    spend: number;
    roas: number;
    startDate: string | null;
    endDate: string | null;
    dataCompleteness: number;
    rawDataJson: string;
    createdAt: string;
    updatedAt: string;
}

export interface CampaignRecommendationRecord {
    id: string;
    storeId: string;
    campaignSnapshotId: string;
    weekStart: string;
    provider: AnalysisProviderName;
    model: string;
    ruleId: string;
    ruleVersion: string;
    recommendationType: RecommendationAction;
    severity: RecommendationSeverity;
    detectedCondition: string;
    currentSetting: string;
    proposedSetting: string;
    supportingMetricsJson: string;
    expectedBenefit: string;
    expectedRoiImpact: number | null;
    expectedProfitImpact: number | null;
    confidence: number;
    risk: RecommendationRisk;
    reason: string;
    rollbackPlan: string;
    humanApprovalRequired: boolean;
    enrichmentStatus: RecommendationEnrichmentStatus;
    rawResponseJson: string;
    status: 'pending' | 'approved' | 'rejected' | 'executed';
    createdAt: string;
}

export interface WorkflowRunRecord {
    id: string;
    workflowName: string;
    trigger: string;
    mode: string;
    timezone: string;
    weekStart: string;
    weekEndExclusive: string;
    status: 'running' | 'success' | 'failed';
    summary: string | null;
    errorMessage: string | null;
    metadataJson: string | null;
    startedAt: string;
    completedAt: string | null;
}

export interface WorkflowStepRecord {
    runId: string;
    stepKey: string;
    attempt: number;
    status: WorkflowStepStatus;
    startedAt: string;
    completedAt: string | null;
    detail: string | null;
    errorMessage: string | null;
    metricsJson: string | null;
}

export interface IngestionIdempotencyRecord {
    idempotencyKey: string;
    messageId: string;
    attachmentHash: string;
    storeId: string;
    weekStart: string;
    sourceRef: string;
    createdAt: string;
}

export interface CampaignAnalysisInput {
    store: ProductionStore;
    snapshot: WeeklyCampaignSnapshot;
    currentBudget: number | null;
    estimatedProfit: number;
    estimatedMargin: number;
    previousSnapshot: WeeklyCampaignSnapshot | null;
    rules: RulesEngineConfig;
    storeWeeklyTotals?: {
        spend: number;
        sales: number;
        orders: number;
    };
}

export interface ProviderRecommendation {
    ruleId: string;
    ruleVersion: string;
    recommendationType: RecommendationAction;
    severity: RecommendationSeverity;
    detectedCondition: string;
    currentSetting: string;
    proposedSetting: string;
    supportingMetrics: SupportingMetrics;
    expectedBenefit: string;
    expectedRoiImpact: number | null;
    expectedProfitImpact: number | null;
    confidence: number;
    risk: RecommendationRisk;
    reason: string;
    rollbackPlan: string;
    humanApprovalRequired: boolean;
    missingData: string[];
    enrichmentStatus: RecommendationEnrichmentStatus;
    enrichmentNotes: string | null;
}

export interface ProviderCampaignAnalysisResult {
    provider: AnalysisProviderName;
    model: string;
    recommendations: ProviderRecommendation[];
    questions: string[];
    summary: string;
}

export interface SanitizedReviewPackage {
    id: string;
    workflowRunId: string;
    storeId: string;
    storeName: string;
    weekStart: string;
    weekEndExclusive: string;
    provider: AnalysisProviderName;
    providerModel: string;
    ruleVersion: string;
    createdAt: string;
    executiveSummary: string;
    campaignMetricsTable: Array<{
        campaignId: string;
        campaignName: string;
        campaignType: string;
        status: string;
        metrics: SupportingMetrics;
    }>;
    anomalies: Array<{
        campaignId: string;
        campaignName: string;
        severity: RecommendationSeverity;
        condition: string;
        metrics: SupportingMetrics;
    }>;
    recommendations: Array<{
        campaignId: string;
        campaignName: string;
        severity: RecommendationSeverity;
        detectedCondition: string;
        supportingMetrics: SupportingMetrics;
        recommendedAction: string;
        expectedBenefit: string;
        confidence: number;
        ruleId: string;
        humanApprovalRequired: boolean;
        enrichmentStatus: RecommendationEnrichmentStatus;
    }>;
    questions: string[];
    readyToCopyPrompt: string;
}
