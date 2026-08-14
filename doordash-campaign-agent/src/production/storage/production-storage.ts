import type {
    CampaignRecommendationRecord,
    IngestionIdempotencyRecord,
    ProductionStore,
    WeeklyCampaignSnapshot,
    WorkflowRunRecord,
    WorkflowStepRecord,
} from '../types.js';

export interface SnapshotUpsertResult {
    created: number;
    updated: number;
    unchanged: number;
}

export interface CreateWorkflowRunInput {
    workflowName: string;
    trigger: string;
    mode: string;
    timezone: string;
    weekStart: string;
    weekEndExclusive: string;
    metadataJson: string | null;
}

export interface ProductionStorage {
    initialize(): Promise<void>;
    close(): Promise<void>;
    listActiveStores(storeIds?: string[]): Promise<ProductionStore[]>;
    createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord>;
    recordWorkflowStep(step: WorkflowStepRecord): Promise<void>;
    completeWorkflowRun(runId: string, summary: string, metadataJson: string | null): Promise<void>;
    failWorkflowRun(runId: string, errorMessage: string, metadataJson: string | null): Promise<void>;
    hasIngestionRecord(idempotencyKey: string): Promise<boolean>;
    saveIngestionRecord(record: IngestionIdempotencyRecord): Promise<void>;
    upsertSnapshots(snapshots: WeeklyCampaignSnapshot[]): Promise<SnapshotUpsertResult>;
    listSnapshotsForWeek(storeId: string, weekStart: string): Promise<WeeklyCampaignSnapshot[]>;
    listMostRecentSnapshotsBeforeWeek(storeId: string, weekStart: string): Promise<WeeklyCampaignSnapshot[]>;
    saveRecommendation(record: CampaignRecommendationRecord): Promise<void>;
}
