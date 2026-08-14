import crypto from 'crypto';
import { Pool } from 'pg';
import type {
    CampaignRecommendationRecord,
    IngestionIdempotencyRecord,
    ProductionStore,
    WeeklyCampaignSnapshot,
    WorkflowRunRecord,
    WorkflowStepRecord,
} from '../types.js';
import type { CreateWorkflowRunInput, ProductionStorage, SnapshotUpsertResult } from './production-storage.js';

function nowIso(): string {
    return new Date().toISOString();
}

function stableId(prefix: string, input: string): string {
    return `${prefix}-${crypto.createHash('sha256').update(input).digest('hex').slice(0, 24)}`;
}

export class PostgresProductionStorage implements ProductionStorage {
    private readonly databaseUrl: string;
    private pool: Pool | null = null;

    constructor(databaseUrl: string) {
        this.databaseUrl = databaseUrl;
    }

    async initialize(): Promise<void> {
        this.pool = new Pool({ connectionString: this.databaseUrl, max: 4 });
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS stores (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                "doorDashAccountId" TEXT,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS campaign_snapshots (
                id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                campaign_name TEXT NOT NULL,
                campaign_type TEXT NOT NULL,
                status TEXT NOT NULL,
                budget DOUBLE PRECISION,
                spend DOUBLE PRECISION NOT NULL,
                sales DOUBLE PRECISION NOT NULL,
                orders INTEGER NOT NULL,
                roas DOUBLE PRECISION NOT NULL,
                start_date TEXT,
                end_date TEXT,
                currency TEXT DEFAULT 'USD',
                raw_data TEXT NOT NULL,
                snapshot_date TIMESTAMPTZ NOT NULL,
                week_start TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                snapshot_source TEXT NOT NULL,
                source_ref TEXT NOT NULL,
                batch_id TEXT NOT NULL,
                report_start_date TEXT NOT NULL,
                report_end_date TEXT NOT NULL,
                data_completeness INTEGER NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL,
                observed_date_start TEXT NOT NULL,
                observed_date_end TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS recommendations (
                id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                campaign_snapshot_id TEXT NOT NULL,
                recommendation_type TEXT NOT NULL,
                current_setting TEXT NOT NULL,
                proposed_setting TEXT NOT NULL,
                expected_roi_impact DOUBLE PRECISION,
                expected_profit_impact DOUBLE PRECISION,
                confidence DOUBLE PRECISION NOT NULL,
                risk TEXT NOT NULL,
                reason TEXT NOT NULL,
                rollback_plan TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                provider TEXT NOT NULL,
                provider_model TEXT NOT NULL,
                week_start TEXT NOT NULL,
                raw_response_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS automation_workflow_runs (
                id TEXT PRIMARY KEY,
                workflow_name TEXT NOT NULL,
                trigger TEXT NOT NULL,
                mode TEXT NOT NULL,
                timezone TEXT NOT NULL,
                week_start TEXT NOT NULL,
                week_end_exclusive TEXT NOT NULL,
                status TEXT NOT NULL,
                summary TEXT,
                error_message TEXT,
                metadata_json TEXT,
                started_at TIMESTAMPTZ NOT NULL,
                completed_at TIMESTAMPTZ
            );

            CREATE TABLE IF NOT EXISTS automation_workflow_steps (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                step_key TEXT NOT NULL,
                attempt INTEGER NOT NULL,
                status TEXT NOT NULL,
                started_at TIMESTAMPTZ NOT NULL,
                completed_at TIMESTAMPTZ,
                detail TEXT,
                error_message TEXT,
                metrics_json TEXT
            );

            CREATE TABLE IF NOT EXISTS ingestion_idempotency (
                idempotency_key TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                attachment_hash TEXT NOT NULL,
                store_id TEXT NOT NULL,
                week_start TEXT NOT NULL,
                source_ref TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            );
        `);
    }

    async close(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    private requirePool(): Pool {
        if (!this.pool) throw new Error('Postgres storage has not been initialized.');
        return this.pool;
    }

    async listActiveStores(storeIds?: string[]): Promise<ProductionStore[]> {
        const pool = this.requirePool();
        if (storeIds && storeIds.length > 0) {
            const rows = await pool.query(`
                SELECT id, name, email, "doorDashAccountId", active
                FROM stores
                WHERE active = TRUE AND id = ANY($1::text[])
                ORDER BY name
            `, [storeIds]);
            return rows.rows.map(row => ({
                id: row.id,
                name: row.name,
                email: row.email,
                doorDashAccountId: row.doorDashAccountId || null,
                active: row.active === true,
            }));
        }
        const rows = await pool.query(`
            SELECT id, name, email, "doorDashAccountId", active
            FROM stores
            WHERE active = TRUE
            ORDER BY name
        `);
        return rows.rows.map(row => ({
            id: row.id,
            name: row.name,
            email: row.email,
            doorDashAccountId: row.doorDashAccountId || null,
            active: row.active === true,
        }));
    }

    async createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord> {
        const pool = this.requirePool();
        const id = stableId('workflow-run', `${input.workflowName}|${input.trigger}|${input.weekStart}|${Date.now()}`);
        const startedAt = nowIso();
        await pool.query(`
            INSERT INTO automation_workflow_runs (
                id, workflow_name, trigger, mode, timezone, week_start, week_end_exclusive, status, metadata_json, started_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'running', $8, $9)
        `, [id, input.workflowName, input.trigger, input.mode, input.timezone, input.weekStart, input.weekEndExclusive, input.metadataJson, startedAt]);
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
            metadataJson: input.metadataJson,
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
            step.detail,
            step.errorMessage,
            step.metricsJson,
        ]);
    }

    async completeWorkflowRun(runId: string, summary: string, metadataJson: string | null): Promise<void> {
        await this.requirePool().query(`
            UPDATE automation_workflow_runs
            SET status = 'success', summary = $1, error_message = NULL, completed_at = $2, metadata_json = COALESCE($3, metadata_json)
            WHERE id = $4
        `, [summary, nowIso(), metadataJson, runId]);
    }

    async failWorkflowRun(runId: string, errorMessage: string, metadataJson: string | null): Promise<void> {
        await this.requirePool().query(`
            UPDATE automation_workflow_runs
            SET status = 'failed', summary = $1, error_message = $2, completed_at = $3, metadata_json = COALESCE($4, metadata_json)
            WHERE id = $5
        `, [errorMessage, errorMessage, nowIso(), metadataJson, runId]);
    }

    async hasIngestionRecord(idempotencyKey: string): Promise<boolean> {
        const result = await this.requirePool().query('SELECT idempotency_key FROM ingestion_idempotency WHERE idempotency_key = $1', [idempotencyKey]);
        return (result.rowCount || 0) > 0;
    }

    async saveIngestionRecord(record: IngestionIdempotencyRecord): Promise<void> {
        await this.requirePool().query(`
            INSERT INTO ingestion_idempotency (
                idempotency_key, message_id, attachment_hash, store_id, week_start, source_ref, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (idempotency_key) DO UPDATE SET created_at = EXCLUDED.created_at
        `, [record.idempotencyKey, record.messageId, record.attachmentHash, record.storeId, record.weekStart, record.sourceRef, record.createdAt]);
    }

    async upsertSnapshots(snapshots: WeeklyCampaignSnapshot[]): Promise<SnapshotUpsertResult> {
        const pool = this.requirePool();
        const result: SnapshotUpsertResult = { created: 0, updated: 0, unchanged: 0 };
        for (const snapshot of snapshots) {
            const existing = await pool.query('SELECT orders, sales, spend, roas, raw_data FROM campaign_snapshots WHERE id = $1', [snapshot.id]);
            await pool.query(`
                INSERT INTO campaign_snapshots (
                    id, store_id, campaign_name, campaign_type, status, budget, spend, sales, orders, roas, start_date, end_date,
                    currency, raw_data, snapshot_date, week_start, created_at, snapshot_source, source_ref, batch_id, report_start_date,
                    report_end_date, data_completeness, updated_at, observed_date_start, observed_date_end
                ) VALUES (
                    $1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, 'USD', $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
                )
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    spend = EXCLUDED.spend,
                    sales = EXCLUDED.sales,
                    orders = EXCLUDED.orders,
                    roas = EXCLUDED.roas,
                    raw_data = EXCLUDED.raw_data,
                    snapshot_date = EXCLUDED.snapshot_date,
                    week_start = EXCLUDED.week_start,
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
            if (existing.rowCount === 0) {
                result.created += 1;
            } else {
                const row = existing.rows[0];
                if (
                    Number(row.orders) === snapshot.orders
                    && Number(row.sales) === snapshot.sales
                    && Number(row.spend) === snapshot.spend
                    && Number(row.roas) === snapshot.roas
                    && String(row.raw_data || '') === snapshot.rawDataJson
                ) {
                    result.unchanged += 1;
                } else {
                    result.updated += 1;
                }
            }
        }
        return result;
    }

    async listSnapshotsForWeek(storeId: string, weekStart: string): Promise<WeeklyCampaignSnapshot[]> {
        const rows = await this.requirePool().query(`
            SELECT id, store_id, campaign_name, campaign_type, status, week_start, report_end_date, snapshot_source, source_ref, batch_id,
                   report_start_date, report_end_date, observed_date_start, observed_date_end, orders, sales, spend, roas,
                   start_date, end_date, data_completeness, raw_data, snapshot_date, updated_at
            FROM campaign_snapshots
            WHERE store_id = $1 AND week_start = $2
            ORDER BY campaign_name
        `, [storeId, weekStart]);
        return rows.rows.map(row => ({
            id: row.id,
            storeId: row.store_id,
            campaignId: this.readCampaignId(row.raw_data, row.id),
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

    async saveRecommendation(record: CampaignRecommendationRecord): Promise<void> {
        await this.requirePool().query(`
            INSERT INTO recommendations (
                id, store_id, campaign_snapshot_id, recommendation_type, current_setting, proposed_setting,
                expected_roi_impact, expected_profit_impact, confidence, risk, reason, rollback_plan, status,
                created_at, provider, provider_model, week_start, raw_response_json
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
            )
            ON CONFLICT (id) DO UPDATE SET raw_response_json = EXCLUDED.raw_response_json
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
            record.rawResponseJson,
        ]);
    }

    private readCampaignId(rawDataJson: string, fallbackId: string): string {
        try {
            const parsed = JSON.parse(rawDataJson) as { campaign?: { campaignId?: string } };
            return parsed.campaign?.campaignId || fallbackId;
        } catch {
            return fallbackId;
        }
    }
}
