import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
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

function encodeJson(value: string | null): string | null {
    return value && value.trim() ? value : null;
}

function ensureColumn(db: Database.Database, tableName: string, columnName: string, definition: string): void {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

export class SqliteProductionStorage implements ProductionStorage {
    private readonly dbPath: string;
    private db: Database.Database | null = null;

    constructor(dbPath: string) {
        this.dbPath = dbPath;
    }

    async initialize(): Promise<void> {
        const dir = path.dirname(this.dbPath);
        fs.mkdirSync(dir, { recursive: true });
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS stores (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                doorDashAccountId TEXT,
                active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS campaign_snapshots (
                id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                campaign_name TEXT NOT NULL,
                campaign_type TEXT NOT NULL,
                status TEXT NOT NULL,
                budget REAL,
                spend REAL NOT NULL,
                sales REAL NOT NULL,
                orders INTEGER NOT NULL,
                roas REAL NOT NULL,
                start_date TEXT,
                end_date TEXT,
                currency TEXT DEFAULT 'USD',
                raw_data TEXT NOT NULL,
                screenshot_path TEXT,
                snapshot_date TEXT NOT NULL,
                week_start TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS recommendations (
                id TEXT PRIMARY KEY,
                store_id TEXT NOT NULL,
                campaign_snapshot_id TEXT NOT NULL,
                recommendation_type TEXT NOT NULL,
                current_setting TEXT NOT NULL,
                proposed_setting TEXT NOT NULL,
                expected_roi_impact REAL,
                expected_profit_impact REAL,
                confidence REAL NOT NULL,
                risk TEXT NOT NULL,
                reason TEXT NOT NULL,
                rollback_plan TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS automation_workflow_runs (
                id TEXT PRIMARY KEY,
                workflow_name TEXT NOT NULL,
                trigger TEXT NOT NULL,
                scope TEXT DEFAULT 'weekly_production',
                mode TEXT NOT NULL,
                timezone TEXT NOT NULL,
                week_start TEXT NOT NULL,
                week_end_exclusive TEXT NOT NULL,
                status TEXT NOT NULL,
                summary TEXT,
                error_message TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                metadata_json TEXT
            );

            CREATE TABLE IF NOT EXISTS automation_workflow_steps (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                step_key TEXT NOT NULL,
                attempt INTEGER NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
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
                created_at TEXT NOT NULL
            );
        `);

        ensureColumn(this.db, 'campaign_snapshots', 'snapshot_source', `TEXT DEFAULT 'email_export'`);
        ensureColumn(this.db, 'campaign_snapshots', 'source_ref', 'TEXT');
        ensureColumn(this.db, 'campaign_snapshots', 'batch_id', 'TEXT');
        ensureColumn(this.db, 'campaign_snapshots', 'report_start_date', 'TEXT');
        ensureColumn(this.db, 'campaign_snapshots', 'report_end_date', 'TEXT');
        ensureColumn(this.db, 'campaign_snapshots', 'data_completeness', 'INTEGER DEFAULT 0');
        ensureColumn(this.db, 'campaign_snapshots', 'updated_at', 'TEXT');
        ensureColumn(this.db, 'campaign_snapshots', 'observed_date_start', 'TEXT');
        ensureColumn(this.db, 'campaign_snapshots', 'observed_date_end', 'TEXT');
        ensureColumn(this.db, 'recommendations', 'provider', `TEXT DEFAULT 'openai'`);
        ensureColumn(this.db, 'recommendations', 'provider_model', 'TEXT');
        ensureColumn(this.db, 'recommendations', 'week_start', 'TEXT');
        ensureColumn(this.db, 'recommendations', 'raw_response_json', 'TEXT');

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_store_week
            ON campaign_snapshots(store_id, week_start, snapshot_source, batch_id);
            CREATE INDEX IF NOT EXISTS idx_recommendations_store_week
            ON recommendations(store_id, week_start, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_workflow_runs_name_started
            ON automation_workflow_runs(workflow_name, started_at DESC);
        `);

        const count = this.db.prepare('SELECT COUNT(*) AS count FROM stores').get() as { count: number };
        if (count.count === 0) {
            const rows: ProductionStore[] = [
                { id: 'bakudan-the-rim', name: 'Bakudan The Rim', email: 'bakudanramen210@gmail.com', doorDashAccountId: null, active: true },
                { id: 'bakudan-stone-oak', name: 'Bakudan Stone Oak', email: 'gm@bakudanramen.com', doorDashAccountId: null, active: true },
                { id: 'bakudan-bandera', name: 'Bakudan Bandera', email: 'info@bakudanramen.com', doorDashAccountId: null, active: true },
                { id: 'raw-sushi-bar', name: 'Raw Sushi Bar', email: 'h.oang.d.le@gmail.com', doorDashAccountId: '892006', active: true },
            ];
            const insert = this.db.prepare(`
                INSERT INTO stores (id, name, email, doorDashAccountId, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const ts = nowIso();
            const tx = this.db.transaction(() => {
                for (const row of rows) {
                    insert.run(row.id, row.name, row.email, row.doorDashAccountId, row.active ? 1 : 0, ts, ts);
                }
            });
            tx();
        }
    }

    async close(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    private requireDb(): Database.Database {
        if (!this.db) throw new Error('SQLite storage has not been initialized.');
        return this.db;
    }

    async listActiveStores(storeIds?: string[]): Promise<ProductionStore[]> {
        const db = this.requireDb();
        if (storeIds && storeIds.length > 0) {
            const placeholders = storeIds.map(() => '?').join(', ');
            const rows = db.prepare(`
                SELECT id, name, email, doorDashAccountId, active
                FROM stores
                WHERE active = 1 AND id IN (${placeholders})
                ORDER BY name
            `).all(...storeIds) as Array<{ id: string; name: string; email: string; doorDashAccountId: string | null; active: number }>;
            return rows.map(row => ({ ...row, active: row.active === 1 }));
        }
        const rows = db.prepare(`
            SELECT id, name, email, doorDashAccountId, active
            FROM stores
            WHERE active = 1
            ORDER BY name
        `).all() as Array<{ id: string; name: string; email: string; doorDashAccountId: string | null; active: number }>;
        return rows.map(row => ({ ...row, active: row.active === 1 }));
    }

    async createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord> {
        const db = this.requireDb();
        const id = stableId('workflow-run', `${input.workflowName}|${input.trigger}|${input.weekStart}|${Date.now()}`);
        const startedAt = nowIso();
        db.prepare(`
            INSERT INTO automation_workflow_runs (
                id, workflow_name, trigger, scope, mode, timezone, week_start, week_end_exclusive, status, started_at, metadata_json
            )
            VALUES (?, ?, ?, 'weekly_production', ?, ?, ?, ?, 'running', ?, ?)
        `).run(id, input.workflowName, input.trigger, input.mode, input.timezone, input.weekStart, input.weekEndExclusive, startedAt, encodeJson(input.metadataJson));
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
            metadataJson: encodeJson(input.metadataJson),
            startedAt,
            completedAt: null,
        };
    }

    async recordWorkflowStep(step: WorkflowStepRecord): Promise<void> {
        const db = this.requireDb();
        db.prepare(`
            INSERT INTO automation_workflow_steps (
                id, run_id, step_key, attempt, status, started_at, completed_at, detail, error_message, metrics_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            stableId('workflow-step', `${step.runId}|${step.stepKey}|${step.attempt}|${step.startedAt}`),
            step.runId,
            step.stepKey,
            step.attempt,
            step.status,
            step.startedAt,
            step.completedAt,
            step.detail,
            step.errorMessage,
            encodeJson(step.metricsJson),
        );
    }

    async completeWorkflowRun(runId: string, summary: string, metadataJson: string | null): Promise<void> {
        this.requireDb().prepare(`
            UPDATE automation_workflow_runs
            SET status = 'success', summary = ?, error_message = NULL, completed_at = ?, metadata_json = COALESCE(?, metadata_json)
            WHERE id = ?
        `).run(summary, nowIso(), encodeJson(metadataJson), runId);
    }

    async failWorkflowRun(runId: string, errorMessage: string, metadataJson: string | null): Promise<void> {
        this.requireDb().prepare(`
            UPDATE automation_workflow_runs
            SET status = 'failed', summary = ?, error_message = ?, completed_at = ?, metadata_json = COALESCE(?, metadata_json)
            WHERE id = ?
        `).run(errorMessage, errorMessage, nowIso(), encodeJson(metadataJson), runId);
    }

    async hasIngestionRecord(idempotencyKey: string): Promise<boolean> {
        const row = this.requireDb().prepare('SELECT idempotency_key FROM ingestion_idempotency WHERE idempotency_key = ?').get(idempotencyKey);
        return Boolean(row);
    }

    async saveIngestionRecord(record: IngestionIdempotencyRecord): Promise<void> {
        this.requireDb().prepare(`
            INSERT OR REPLACE INTO ingestion_idempotency (
                idempotency_key, message_id, attachment_hash, store_id, week_start, source_ref, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            record.idempotencyKey,
            record.messageId,
            record.attachmentHash,
            record.storeId,
            record.weekStart,
            record.sourceRef,
            record.createdAt,
        );
    }

    async upsertSnapshots(snapshots: WeeklyCampaignSnapshot[]): Promise<SnapshotUpsertResult> {
        const db = this.requireDb();
        const result: SnapshotUpsertResult = { created: 0, updated: 0, unchanged: 0 };
        const selectExisting = db.prepare(`
            SELECT orders, sales, spend, roas, raw_data, updated_at
            FROM campaign_snapshots
            WHERE id = ?
        `);
        const upsert = db.prepare(`
            INSERT INTO campaign_snapshots (
                id, store_id, campaign_name, campaign_type, status, budget, spend, sales, orders, roas, start_date, end_date,
                currency, raw_data, screenshot_path, snapshot_date, week_start, created_at, snapshot_source, source_ref, batch_id,
                report_start_date, report_end_date, data_completeness, updated_at, observed_date_start, observed_date_end
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                spend = excluded.spend,
                sales = excluded.sales,
                orders = excluded.orders,
                roas = excluded.roas,
                raw_data = excluded.raw_data,
                snapshot_date = excluded.snapshot_date,
                week_start = excluded.week_start,
                snapshot_source = excluded.snapshot_source,
                source_ref = excluded.source_ref,
                batch_id = excluded.batch_id,
                report_start_date = excluded.report_start_date,
                report_end_date = excluded.report_end_date,
                data_completeness = excluded.data_completeness,
                updated_at = excluded.updated_at,
                observed_date_start = excluded.observed_date_start,
                observed_date_end = excluded.observed_date_end
        `);

        const tx = db.transaction(() => {
            for (const snapshot of snapshots) {
                const existing = selectExisting.get(snapshot.id) as { orders: number; sales: number; spend: number; roas: number; raw_data: string; updated_at: string } | undefined;
                upsert.run(
                    snapshot.id,
                    snapshot.storeId,
                    snapshot.campaignName,
                    snapshot.campaignType,
                    snapshot.status,
                    null,
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
                );
                if (!existing) {
                    result.created += 1;
                } else if (
                    Number(existing.orders) === snapshot.orders
                    && Number(existing.sales) === snapshot.sales
                    && Number(existing.spend) === snapshot.spend
                    && Number(existing.roas) === snapshot.roas
                    && String(existing.raw_data || '') === snapshot.rawDataJson
                ) {
                    result.unchanged += 1;
                } else {
                    result.updated += 1;
                }
            }
        });
        tx();
        return result;
    }

    async listSnapshotsForWeek(storeId: string, weekStart: string): Promise<WeeklyCampaignSnapshot[]> {
        const rows = this.requireDb().prepare(`
            SELECT
                id,
                store_id AS storeId,
                campaign_name AS campaignName,
                campaign_type AS campaignType,
                status,
                week_start AS weekStart,
                report_end_date AS weekEndExclusive,
                snapshot_source AS snapshotSource,
                source_ref AS sourceRef,
                batch_id AS batchId,
                report_start_date AS reportStartDate,
                report_end_date AS reportEndDate,
                observed_date_start AS observedDateStart,
                observed_date_end AS observedDateEnd,
                orders,
                sales,
                spend,
                roas,
                start_date AS startDate,
                end_date AS endDate,
                data_completeness AS dataCompleteness,
                raw_data AS rawDataJson,
                snapshot_date AS createdAt,
                updated_at AS updatedAt
            FROM campaign_snapshots
            WHERE store_id = ? AND week_start = ?
            ORDER BY campaign_name
        `).all(storeId, weekStart) as WeeklyCampaignSnapshot[];
        return rows.map(row => ({
            ...row,
            campaignId: this.readCampaignId(row.rawDataJson, row.id),
        }));
    }

    async listMostRecentSnapshotsBeforeWeek(storeId: string, weekStart: string): Promise<WeeklyCampaignSnapshot[]> {
        const row = this.requireDb().prepare(`
            SELECT week_start
            FROM campaign_snapshots
            WHERE store_id = ? AND week_start < ?
            ORDER BY week_start DESC
            LIMIT 1
        `).get(storeId, weekStart) as { week_start?: string } | undefined;
        if (!row?.week_start) return [];
        return this.listSnapshotsForWeek(storeId, row.week_start);
    }

    async saveRecommendation(record: CampaignRecommendationRecord): Promise<void> {
        this.requireDb().prepare(`
            INSERT OR REPLACE INTO recommendations (
                id, store_id, campaign_snapshot_id, recommendation_type, current_setting, proposed_setting,
                expected_roi_impact, expected_profit_impact, confidence, risk, reason, rollback_plan, status,
                created_at, provider, provider_model, week_start, raw_response_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
        );
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
