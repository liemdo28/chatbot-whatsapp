import crypto from 'crypto';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type {
    CampaignRecommendationRecord,
    IngestionIdempotencyRecord,
    ProductionStore,
    WeeklyCampaignSnapshot,
    WorkflowRunRecord,
    WorkflowStepRecord,
} from '../types.js';
import { sanitizeErrorMessage, sanitizeJsonString } from '../security/error-sanitizer.js';
import { configuredProductionStores, validateProductionStoreCatalog } from '../store-catalog.js';
import type {
    CreateWorkflowRunInput,
    PersistStoreBundleInput,
    PersistStoreBundleResult,
    ProductionStorage,
    SnapshotUpsertResult,
} from './production-storage.js';
import { runPostgresMigrations } from './postgres-migrations.js';

function nowIso(): string {
    return new Date().toISOString();
}

function stableId(prefix: string, input: string): string {
    return `${prefix}-${crypto.createHash('sha256').update(input).digest('hex').slice(0, 24)}`;
}

function encodeJson(value: string | null): string | null {
    return value && value.trim() ? value : null;
}

export interface PostgresProductionStorageHooks {
    beforePersistIngestionRecord?(client: PoolClient, input: PersistStoreBundleInput): Promise<void>;
}

export interface PostgresProductionStorageOptions {
    poolConfig?: Partial<PoolConfig>;
    hooks?: PostgresProductionStorageHooks;
}

export class PostgresProductionStorage implements ProductionStorage {
    private readonly databaseUrl: string;
    private readonly options: PostgresProductionStorageOptions;
    private pool: Pool | null = null;

    constructor(databaseUrl: string, options: PostgresProductionStorageOptions = {}) {
        this.databaseUrl = databaseUrl;
        this.options = options;
    }

    async initialize(): Promise<void> {
        this.pool = new Pool({
            connectionString: this.databaseUrl,
            max: 6,
            allowExitOnIdle: true,
            application_name: 'doordash-weekly-production',
            ...this.options.poolConfig,
        });
        await runPostgresMigrations(this.pool);
        await this.syncConfiguredStores();
    }

    async close(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    private requirePool(): Pool {
        if (!this.pool) {
            throw new Error('Postgres storage has not been initialized.');
        }
        return this.pool;
    }

    private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.requirePool().connect();
        try {
            return await fn(client);
        } finally {
            client.release();
        }
    }

    private async syncConfiguredStores(): Promise<void> {
        const stores = validateProductionStoreCatalog();
        await this.withClient(async (client) => {
            const timestamp = nowIso();
            for (const store of stores) {
                await this.upsertStore(client, store, timestamp);
            }
        });
    }

    private async upsertStore(client: PoolClient, store: ProductionStore, timestamp: string): Promise<void> {
        await client.query(`
            INSERT INTO stores (id, name, email, "doorDashAccountId", active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $6)
            ON CONFLICT (id) DO UPDATE SET
                name = COALESCE(NULLIF(stores.name, ''), EXCLUDED.name),
                email = COALESCE(NULLIF(stores.email, ''), EXCLUDED.email),
                "doorDashAccountId" = COALESCE(NULLIF(stores."doorDashAccountId", ''), EXCLUDED."doorDashAccountId"),
                active = stores.active,
                updated_at = EXCLUDED.updated_at
        `, [
            store.id,
            store.name,
            store.email,
            store.doorDashAccountId,
            store.active,
            timestamp,
        ]);
    }

    async listActiveStores(storeIds?: string[]): Promise<ProductionStore[]> {
        const pool = this.requirePool();
        if (storeIds && storeIds.length > 0) {
            const result = await pool.query(`
                SELECT id, name, email, "doorDashAccountId", active
                FROM stores
                WHERE active = TRUE AND id = ANY($1::text[])
                ORDER BY name
            `, [storeIds]);
            return result.rows.map(row => ({
                id: row.id,
                name: row.name,
                email: row.email,
                doorDashAccountId: row.doorDashAccountId || null,
                active: row.active === true,
            }));
        }

        const result = await pool.query(`
            SELECT id, name, email, "doorDashAccountId", active
            FROM stores
            WHERE active = TRUE
            ORDER BY name
        `);
        return result.rows.map(row => ({
            id: row.id,
            name: row.name,
            email: row.email,
            doorDashAccountId: row.doorDashAccountId || null,
            active: row.active === true,
        }));
    }

    async createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord> {
        const id = stableId('workflow-run', `${input.workflowName}|${input.trigger}|${input.weekStart}|${Date.now()}`);
        const startedAt = nowIso();
        await this.requirePool().query(`
            INSERT INTO automation_workflow_runs (
                id, workflow_name, trigger, scope, mode, timezone, week_start, week_end_exclusive, status, metadata_json, started_at
            ) VALUES ($1, $2, $3, 'weekly_production', $4, $5, $6, $7, 'running', $8, $9)
        `, [
            id,
            input.workflowName,
            input.trigger,
            input.mode,
            input.timezone,
            input.weekStart,
            input.weekEndExclusive,
            sanitizeJsonString(encodeJson(input.metadataJson)),
            startedAt,
        ]);
        return {
            id,
            workflowName: input.workflowName,
            trigger: input.trigger,
            mode: input.mode,
            timezone: input.timezone,
            weekStart: input.weekStart,
            weekEndExclusive: input.weekEndExclusive,
            status: 'running',
            summary: null,
            errorMessage: null,
            metadataJson: sanitizeJsonString(encodeJson(input.metadataJson)),
            startedAt,
            completedAt: null,
        };
    }

    async recordWorkflowStep(step: WorkflowStepRecord): Promise<void> {
        await this.requirePool().query(`
            INSERT INTO automation_workflow_steps (
                id, run_id, step_key, attempt, status, started_at, completed_at, detail, error_message, metrics_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
            stableId('workflow-step', `${step.runId}|${step.stepKey}|${step.attempt}|${step.startedAt}`),
            step.runId,
            step.stepKey,
            step.attempt,
            step.status,
            step.startedAt,
            step.completedAt,
            step.detail ? sanitizeErrorMessage(step.detail) : null,
            step.errorMessage ? sanitizeErrorMessage(step.errorMessage) : null,
            sanitizeJsonString(encodeJson(step.metricsJson)),
        ]);
    }

    async completeWorkflowRun(runId: string, summary: string, metadataJson: string | null): Promise<void> {
        await this.requirePool().query(`
            UPDATE automation_workflow_runs
            SET status = 'success',
                summary = $1,
                error_message = NULL,
                completed_at = $2,
                metadata_json = COALESCE($3, metadata_json)
            WHERE id = $4
        `, [
            sanitizeErrorMessage(summary),
            nowIso(),
            sanitizeJsonString(encodeJson(metadataJson)),
            runId,
        ]);
    }

    async failWorkflowRun(runId: string, errorMessage: string, metadataJson: string | null): Promise<void> {
        const sanitized = sanitizeErrorMessage(errorMessage);
        await this.requirePool().query(`
            UPDATE automation_workflow_runs
            SET status = 'failed',
                summary = $1,
                error_message = $1,
                completed_at = $2,
                metadata_json = COALESCE($3, metadata_json)
            WHERE id = $4
        `, [
            sanitized,
            nowIso(),
            sanitizeJsonString(encodeJson(metadataJson)),
            runId,
        ]);
    }

    async hasIngestionRecord(idempotencyKey: string): Promise<boolean> {
        const result = await this.requirePool().query(
            'SELECT idempotency_key FROM ingestion_idempotency WHERE idempotency_key = $1',
            [idempotencyKey],
        );
        return (result.rowCount || 0) > 0;
    }

    async saveIngestionRecord(record: IngestionIdempotencyRecord): Promise<void> {
        await this.requirePool().query(`
            INSERT INTO ingestion_idempotency (
                idempotency_key, message_id, attachment_hash, store_id, week_start, source_ref, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (message_id, attachment_hash, store_id, week_start) DO UPDATE SET
                idempotency_key = EXCLUDED.idempotency_key,
                source_ref = EXCLUDED.source_ref,
                created_at = EXCLUDED.created_at
        `, [
            record.idempotencyKey,
            record.messageId,
            record.attachmentHash,
            record.storeId,
            record.weekStart,
            record.sourceRef,
            record.createdAt,
        ]);
    }

    private async upsertSnapshotsWithClient(client: PoolClient, snapshots: WeeklyCampaignSnapshot[]): Promise<SnapshotUpsertResult> {
        const result: SnapshotUpsertResult = { created: 0, updated: 0, unchanged: 0 };

        for (const snapshot of snapshots) {
            const existing = await client.query(`
                SELECT id, orders, sales, spend, roas, raw_data
                FROM campaign_snapshots
                WHERE store_id = $1 AND week_start = $2 AND campaign_id = $3
            `, [snapshot.storeId, snapshot.weekStart, snapshot.campaignId]);
            const existingRow = existing.rows[0];

            await client.query(`
                INSERT INTO campaign_snapshots (
                    id, store_id, campaign_id, campaign_name, campaign_type, status, budget, spend, sales, orders, roas, start_date, end_date,
                    currency, raw_data, snapshot_date, week_start, created_at, snapshot_source, source_ref, batch_id, report_start_date,
                    report_end_date, data_completeness, updated_at, observed_date_start, observed_date_end
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11, $12, 'USD', $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
                )
                ON CONFLICT (store_id, week_start, campaign_id) DO UPDATE SET
                    campaign_name = EXCLUDED.campaign_name,
                    campaign_type = EXCLUDED.campaign_type,
                    status = EXCLUDED.status,
                    spend = EXCLUDED.spend,
                    sales = EXCLUDED.sales,
                    orders = EXCLUDED.orders,
                    roas = EXCLUDED.roas,
                    start_date = EXCLUDED.start_date,
                    end_date = EXCLUDED.end_date,
                    raw_data = EXCLUDED.raw_data,
                    snapshot_date = EXCLUDED.snapshot_date,
                    snapshot_source = EXCLUDED.snapshot_source,
                    source_ref = EXCLUDED.source_ref,
                    batch_id = EXCLUDED.batch_id,
                    report_start_date = EXCLUDED.report_start_date,
                    report_end_date = EXCLUDED.report_end_date,
                    data_completeness = EXCLUDED.data_completeness,
                    updated_at = EXCLUDED.updated_at,
                    observed_date_start = EXCLUDED.observed_date_start,
                    observed_date_end = EXCLUDED.observed_date_end
            `, [
                snapshot.id,
                snapshot.storeId,
                snapshot.campaignId,
                snapshot.campaignName,
                snapshot.campaignType,
                snapshot.status,
                snapshot.spend,
                snapshot.sales,
                snapshot.orders,
                snapshot.roas,
                snapshot.startDate,
                snapshot.endDate,
                snapshot.rawDataJson,
                snapshot.createdAt,
                snapshot.weekStart,
                snapshot.createdAt,
                snapshot.snapshotSource,
                snapshot.sourceRef,
                snapshot.batchId,
                snapshot.reportStartDate,
                snapshot.reportEndDate,
                snapshot.dataCompleteness,
                snapshot.updatedAt,
                snapshot.observedDateStart,
                snapshot.observedDateEnd,
            ]);

            if (!existingRow) {
                result.created += 1;
                continue;
            }

            if (
                Number(existingRow.orders) === snapshot.orders
                && Number(existingRow.sales) === snapshot.sales
                && Number(existingRow.spend) === snapshot.spend
                && Number(existingRow.roas) === snapshot.roas
                && String(existingRow.raw_data || '') === snapshot.rawDataJson
            ) {
                result.unchanged += 1;
            } else {
                result.updated += 1;
            }
        }

        return result;
    }

    async upsertSnapshots(snapshots: WeeklyCampaignSnapshot[]): Promise<SnapshotUpsertResult> {
        return this.withClient(client => this.upsertSnapshotsWithClient(client, snapshots));
    }

    async listSnapshotsForWeek(storeId: string, weekStart: string): Promise<WeeklyCampaignSnapshot[]> {
        const result = await this.requirePool().query(`
            SELECT
                id,
                store_id,
                campaign_id,
                campaign_name,
                campaign_type,
                status,
                week_start,
                report_end_date,
                snapshot_source,
                source_ref,
                batch_id,
                report_start_date,
                report_end_date,
                observed_date_start,
                observed_date_end,
                orders,
                sales,
                spend,
                roas,
                start_date,
                end_date,
                data_completeness,
                raw_data,
                snapshot_date,
                updated_at
            FROM campaign_snapshots
            WHERE store_id = $1 AND week_start = $2
            ORDER BY campaign_name
        `, [storeId, weekStart]);

        return result.rows.map(row => ({
            id: row.id,
            storeId: row.store_id,
            campaignId: row.campaign_id,
            campaignName: row.campaign_name,
            campaignType: row.campaign_type,
            status: row.status,
            weekStart: row.week_start,
            weekEndExclusive: row.report_end_date,
            snapshotSource: row.snapshot_source,
            sourceRef: row.source_ref,
            batchId: row.batch_id,
            reportStartDate: row.report_start_date,
            reportEndDate: row.report_end_date,
            observedDateStart: row.observed_date_start,
            observedDateEnd: row.observed_date_end,
            orders: Number(row.orders),
            sales: Number(row.sales),
            spend: Number(row.spend),
            roas: Number(row.roas),
            startDate: row.start_date,
            endDate: row.end_date,
            dataCompleteness: Number(row.data_completeness),
            rawDataJson: row.raw_data,
            createdAt: new Date(row.snapshot_date).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
        }));
    }

    async listMostRecentSnapshotsBeforeWeek(storeId: string, weekStart: string): Promise<WeeklyCampaignSnapshot[]> {
        const result = await this.requirePool().query(`
            SELECT week_start
            FROM campaign_snapshots
            WHERE store_id = $1 AND week_start < $2
            ORDER BY week_start DESC
            LIMIT 1
        `, [storeId, weekStart]);
        const priorWeek = result.rows[0]?.week_start;
        return priorWeek ? this.listSnapshotsForWeek(storeId, priorWeek) : [];
    }

    private async saveRecommendationWithClient(client: PoolClient, record: CampaignRecommendationRecord): Promise<void> {
        await client.query(`
            INSERT INTO recommendations (
                id, store_id, campaign_snapshot_id, recommendation_type, current_setting, proposed_setting,
                expected_roi_impact, expected_profit_impact, confidence, risk, reason, rollback_plan, status,
                created_at, provider, provider_model, week_start, raw_response_json
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
            )
            ON CONFLICT (campaign_snapshot_id, provider, week_start, recommendation_type, proposed_setting) DO UPDATE SET
                current_setting = EXCLUDED.current_setting,
                expected_roi_impact = EXCLUDED.expected_roi_impact,
                expected_profit_impact = EXCLUDED.expected_profit_impact,
                confidence = EXCLUDED.confidence,
                risk = EXCLUDED.risk,
                reason = EXCLUDED.reason,
                rollback_plan = EXCLUDED.rollback_plan,
                status = EXCLUDED.status,
                created_at = EXCLUDED.created_at,
                provider_model = EXCLUDED.provider_model,
                raw_response_json = EXCLUDED.raw_response_json
        `, [
            record.id,
            record.storeId,
            record.campaignSnapshotId,
            record.recommendationType,
            record.currentSetting,
            record.proposedSetting,
            record.expectedRoiImpact,
            record.expectedProfitImpact,
            record.confidence,
            record.risk,
            record.reason,
            record.rollbackPlan,
            record.status,
            record.createdAt,
            record.provider,
            record.model,
            record.weekStart,
            sanitizeJsonString(record.rawResponseJson),
        ]);
    }

    async saveRecommendation(record: CampaignRecommendationRecord): Promise<void> {
        await this.withClient(client => this.saveRecommendationWithClient(client, record));
    }

    async persistStoreBundle(input: PersistStoreBundleInput): Promise<PersistStoreBundleResult> {
        return this.withClient(async (client) => {
            const result: PersistStoreBundleResult = {
                alreadyProcessed: false,
                recommendationCount: input.recommendations.length,
                upsert: { created: 0, updated: 0, unchanged: 0 },
            };

            const configuredStore = configuredProductionStores().find(store => store.id === input.store.id) || input.store;
            const stepTimestamp = nowIso();

            try {
                await client.query('BEGIN');
                await this.upsertStore(client, configuredStore, stepTimestamp);

                const insertedIdempotency = await client.query(`
                    INSERT INTO ingestion_idempotency (
                        idempotency_key, message_id, attachment_hash, store_id, week_start, source_ref, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (message_id, attachment_hash, store_id, week_start) DO NOTHING
                    RETURNING idempotency_key
                `, [
                    input.ingestionRecord.idempotencyKey,
                    input.ingestionRecord.messageId,
                    input.ingestionRecord.attachmentHash,
                    input.ingestionRecord.storeId,
                    input.ingestionRecord.weekStart,
                    input.ingestionRecord.sourceRef,
                    input.ingestionRecord.createdAt,
                ]);

                if ((insertedIdempotency.rowCount || 0) === 0) {
                    result.alreadyProcessed = true;
                    await this.insertStepWithClient(client, {
                        runId: input.workflowRunId,
                        stepKey: `ingest_${input.store.id}`,
                        attempt: input.ingestAttempt,
                        status: 'success',
                        startedAt: stepTimestamp,
                        completedAt: stepTimestamp,
                        detail: `Report ${input.ingestionRecord.sourceRef} was already processed for ${input.store.id}.`,
                        errorMessage: null,
                        metricsJson: JSON.stringify({ alreadyProcessed: true }),
                    });
                    await this.insertStepWithClient(client, {
                        runId: input.workflowRunId,
                        stepKey: `analyze_${input.store.id}`,
                        attempt: input.analyzeAttempt,
                        status: 'skipped',
                        startedAt: stepTimestamp,
                        completedAt: stepTimestamp,
                        detail: `Recommendation persistence skipped because ${input.store.id} was already processed for ${input.ingestionRecord.weekStart}.`,
                        errorMessage: null,
                        metricsJson: JSON.stringify({ alreadyProcessed: true }),
                    });
                    await client.query('COMMIT');
                    return result;
                }

                result.upsert = await this.upsertSnapshotsWithClient(client, input.snapshots);

                const snapshotRows = await client.query(`
                    SELECT id, campaign_id
                    FROM campaign_snapshots
                    WHERE store_id = $1 AND week_start = $2
                `, [input.store.id, input.ingestionRecord.weekStart]);
                const snapshotIdByCampaignId = new Map<string, string>(
                    snapshotRows.rows.map(row => [row.campaign_id, row.id]),
                );

                for (const recommendation of input.recommendations) {
                    const sourceSnapshot = input.snapshots.find(snapshot => snapshot.id === recommendation.campaignSnapshotId);
                    const persistedSnapshotId = sourceSnapshot
                        ? snapshotIdByCampaignId.get(sourceSnapshot.campaignId) || recommendation.campaignSnapshotId
                        : recommendation.campaignSnapshotId;
                    await this.saveRecommendationWithClient(client, {
                        ...recommendation,
                        campaignSnapshotId: persistedSnapshotId,
                    });
                }

                if (this.options.hooks?.beforePersistIngestionRecord) {
                    await this.options.hooks.beforePersistIngestionRecord(client, input);
                }

                await this.insertStepWithClient(client, {
                    runId: input.workflowRunId,
                    stepKey: `ingest_${input.store.id}`,
                    attempt: input.ingestAttempt,
                    status: 'success',
                    startedAt: stepTimestamp,
                    completedAt: stepTimestamp,
                    detail: sanitizeErrorMessage(input.ingestDetail),
                    errorMessage: null,
                    metricsJson: input.ingestMetricsJson,
                });
                await this.insertStepWithClient(client, {
                    runId: input.workflowRunId,
                    stepKey: `analyze_${input.store.id}`,
                    attempt: input.analyzeAttempt,
                    status: 'success',
                    startedAt: stepTimestamp,
                    completedAt: stepTimestamp,
                    detail: sanitizeErrorMessage(input.analyzeDetail),
                    errorMessage: null,
                    metricsJson: input.analyzeMetricsJson,
                });

                await client.query('COMMIT');
                return result;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        });
    }

    private async insertStepWithClient(client: PoolClient, step: WorkflowStepRecord): Promise<void> {
        await client.query(`
            INSERT INTO automation_workflow_steps (
                id, run_id, step_key, attempt, status, started_at, completed_at, detail, error_message, metrics_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
            stableId('workflow-step', `${step.runId}|${step.stepKey}|${step.attempt}|${step.startedAt}`),
            step.runId,
            step.stepKey,
            step.attempt,
            step.status,
            step.startedAt,
            step.completedAt,
            step.detail ? sanitizeErrorMessage(step.detail) : null,
            step.errorMessage ? sanitizeErrorMessage(step.errorMessage) : null,
            sanitizeJsonString(encodeJson(step.metricsJson)),
        ]);
    }
}
