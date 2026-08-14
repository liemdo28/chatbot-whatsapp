export type AnalysisProviderName = 'openai' | 'browser';
export type ReportSourceName = 'imap' | 'fixture';
export type StorageBackendName = 'sqlite' | 'postgres';
export type WorkflowStepStatus = 'running' | 'success' | 'failed' | 'retrying' | 'skipped';
export type RecommendationAction = 'INCREASE' | 'DECREASE' | 'PAUSE' | 'RESUME' | 'TEST' | 'KEEP' | 'REQUEST_MORE_DATA';
export type RecommendationRisk = 'low' | 'medium' | 'high';

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
    recommendationType: RecommendationAction;
    currentSetting: string;
    proposedSetting: string;
    expectedRoiImpact: number | null;
    expectedProfitImpact: number | null;
    confidence: number;
    risk: RecommendationRisk;
    reason: string;
    rollbackPlan: string;
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
}

export interface ProviderRecommendation {
    recommendationType: RecommendationAction;
    currentSetting: string;
    proposedSetting: string;
    expectedRoiImpact: number | null;
    expectedProfitImpact: number | null;
    confidence: number;
    risk: RecommendationRisk;
    reason: string;
    rollbackPlan: string;
    missingData: string[];
}
