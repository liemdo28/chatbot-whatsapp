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
import { sanitizeErrorMessage, sanitizeJsonString } from '../security/error-sanitizer.js';
import { configuredProductionStores, validateProductionStoreCatalog } from '../store-catalog.js';
import type { CreateWorkflowRunInput, PersistStoreBundleInput, PersistStoreBundleResult, ProductionStorage, SnapshotUpsertResult } from './production-storage.js';

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

function encodeStoreText(value: string | null | undefined): string | null {
    const normalized = String(value || '').trim();
    return normalized ? normalized : null;
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
                rule_id TEXT NOT NULL DEFAULT '',
                rule_version TEXT NOT NULL DEFAULT '',
                severity TEXT NOT NULL DEFAULT 'medium',
                detected_condition TEXT NOT NULL DEFAULT '',
                current_setting TEXT NOT NULL,
                proposed_setting TEXT NOT NULL,
                supporting_metrics_json TEXT NOT NULL DEFAULT '{}',
                expected_benefit TEXT NOT NULL DEFAULT '',
                expected_roi_impact REAL,
                expected_profit_impact REAL,
                confidence REAL NOT NULL,
                risk TEXT NOT NULL,
                reason TEXT NOT NULL,
                rollback_plan TEXT NOT NULL,
                human_approval_required INTEGER NOT NULL DEFAULT 1,
                enrichment_status TEXT NOT NULL DEFAULT 'not_applicable',
                status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS review_packages (
                id TEXT PRIMARY KEY,
                workflow_run_id TEXT NOT NULL,
                store_id TEXT NOT NULL,
                week_start TEXT NOT NULL,
                provider TEXT NOT NULL,
                rule_version TEXT NOT NULL,
                package_json TEXT NOT NULL,
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
        ensureColumn(this.db, 'campaign_snapshots', 'campaign_id', 'TEXT');
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
        ensureColumn(this.db, 'recommendations', 'rule_id', `TEXT DEFAULT ''`);
        ensureColumn(this.db, 'recommendations', 'rule_version', `TEXT DEFAULT ''`);
        ensureColumn(this.db, 'recommendations', 'severity', `TEXT DEFAULT 'medium'`);
        ensureColumn(this.db, 'recommendations', 'detected_condition', `TEXT DEFAULT ''`);
        ensureColumn(this.db, 'recommendations', 'supporting_metrics_json', `TEXT DEFAULT '{}'`);
        ensureColumn(this.db, 'recommendations', 'expected_benefit', `TEXT DEFAULT ''`);
        ensureColumn(this.db, 'recommendations', 'human_approval_required', 'INTEGER DEFAULT 1');
        ensureColumn(this.db, 'recommendations', 'enrichment_status', `TEXT DEFAULT 'not_applicable'`);

        this.db.exec(`
            UPDATE campaign_snapshots
            SET campaign_id = COALESCE(
                campaign_id,
                json_extract(raw_data, '$.campaign.campaignId'),
                id
            )
            WHERE campaign_id IS NULL OR campaign_id = '';

            CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_store_week
            ON campaign_snapshots(store_id, week_start, snapshot_source, batch_id);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_snapshots_store_week_campaign
            ON campaign_snapshots(store_id, week_start, campaign_id);
            CREATE INDEX IF NOT EXISTS idx_recommendations_store_week
            ON recommendations(store_id, week_start, created_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendations_identity_v2
            ON recommendations(campaign_snapshot_id, provider, week_start, rule_id);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_review_packages_store_week_provider
            ON review_packages(store_id, week_start, provider);
            CREATE INDEX IF NOT EXISTS idx_workflow_runs_name_started
            ON automation_workflow_runs(workflow_name, started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_started
            ON automation_workflow_runs(status, started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_workflow_steps_run_status_started
            ON automation_workflow_steps(run_id, status, started_at DESC);
        `);

        this.syncConfiguredStores();
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

    private syncConfiguredStores(): void {
        const db = this.requireDb();
        const stores = validateProductionStoreCatalog();
        const statement = db.prepare(`
            INSERT INTO stores (id, name, email, doorDashAccountId, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = COALESCE(NULLIF(stores.name, ''), excluded.name),
                email = COALESCE(NULLIF(stores.email, ''), excluded.email),
                doorDashAccountId = COALESCE(NULLIF(stores.doorDashAccountId, ''), excluded.doorDashAccountId),
                updated_at = excluded.updated_at
        `);
        const timestamp = nowIso();
        const tx = db.transaction(() => {
            for (const store of stores) {
                statement.run(store.id, store.name, store.email, store.doorDashAccountId, store.active ? 1 : 0, timestamp, timestamp);
            }
        });
        tx();
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
            step.detail ? sanitizeErrorMessage(step.detail) : null,
            step.errorMessage ? sanitizeErrorMessage(step.errorMessage) : null,
            sanitizeJsonString(encodeJson(step.metricsJson)),
        );
    }

    async completeWorkflowRun(runId: string, summary: string, metadataJson: string | null): Promise<void> {
        this.requireDb().prepare(`
            UPDATE automation_workflow_runs
            SET status = 'success', summary = ?, error_message = NULL, completed_at = ?, metadata_json = COALESCE(?, metadata_json)
            WHERE id = ?
        `).run(sanitizeErrorMessage(summary), nowIso(), sanitizeJsonString(encodeJson(metadataJson)), runId);
    }

    async failWorkflowRun(runId: string, errorMessage: string, metadataJson: string | null): Promise<void> {
        this.requireDb().prepare(`
            UPDATE automation_workflow_runs
            SET status = 'failed', summary = ?, error_message = ?, completed_at = ?, metadata_json = COALESCE(?, metadata_json)
            WHERE id = ?
        `).run(sanitizeErrorMessage(errorMessage), sanitizeErrorMessage(errorMessage), nowIso(), sanitizeJsonString(encodeJson(metadataJson)), runId);
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
            WHERE store_id = ? AND week_start = ? AND campaign_id = ?
        `);
        const upsert = db.prepare(`
            INSERT INTO campaign_snapshots (
                id, store_id, campaign_id, campaign_name, campaign_type, status, budget, spend, sales, orders, roas, start_date, end_date,
                currency, raw_data, screenshot_path, snapshot_date, week_start, created_at, snapshot_source, source_ref, batch_id,
                report_start_date, report_end_date, data_completeness, updated_at, observed_date_start, observed_date_end
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(store_id, week_start, campaign_id) DO UPDATE SET
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
                const existing = selectExisting.get(snapshot.storeId, snapshot.weekStart, snapshot.campaignId) as { orders: number; sales: number; spend: number; roas: number; raw_data: string; updated_at: string } | undefined;
                upsert.run(
                    snapshot.id,
                    snapshot.storeId,
                    snapshot.campaignId,
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
                campaign_id AS campaignId,
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
        return rows;
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
            INSERT INTO recommendations (
                id, store_id, campaign_snapshot_id, recommendation_type, current_setting, proposed_setting,
                rule_id, rule_version, severity, detected_condition, supporting_metrics_json, expected_benefit,
                expected_roi_impact, expected_profit_impact, confidence, risk, reason, rollback_plan, human_approval_required,
                enrichment_status, status, created_at, provider, provider_model, week_start, raw_response_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(campaign_snapshot_id, provider, week_start, rule_id) DO UPDATE SET
                current_setting = excluded.current_setting,
                rule_version = excluded.rule_version,
                severity = excluded.severity,
                detected_condition = excluded.detected_condition,
                supporting_metrics_json = excluded.supporting_metrics_json,
                expected_benefit = excluded.expected_benefit,
                expected_roi_impact = excluded.expected_roi_impact,
                expected_profit_impact = excluded.expected_profit_impact,
                confidence = excluded.confidence,
                risk = excluded.risk,
                reason = excluded.reason,
                rollback_plan = excluded.rollback_plan,
                human_approval_required = excluded.human_approval_required,
                enrichment_status = excluded.enrichment_status,
                status = excluded.status,
                created_at = excluded.created_at,
                provider_model = excluded.provider_model,
                raw_response_json = excluded.raw_response_json
        `).run(
            record.id,
            record.storeId,
            record.campaignSnapshotId,
            record.recommendationType,
            record.currentSetting,
            record.proposedSetting,
            record.ruleId,
            record.ruleVersion,
            record.severity,
            record.detectedCondition,
            sanitizeJsonString(record.supportingMetricsJson),
            record.expectedBenefit,
            record.expectedRoiImpact,
            record.expectedProfitImpact,
            record.confidence,
            record.risk,
            record.reason,
            record.rollbackPlan,
            record.humanApprovalRequired ? 1 : 0,
            record.enrichmentStatus,
            record.status,
            record.createdAt,
            record.provider,
            record.model,
            record.weekStart,
            sanitizeJsonString(record.rawResponseJson),
        );
    }

    async persistStoreBundle(input: PersistStoreBundleInput): Promise<PersistStoreBundleResult> {
        const db = this.requireDb();
        const result: PersistStoreBundleResult = {
            alreadyProcessed: false,
            recommendationCount: input.recommendations.length,
            upsert: { created: 0, updated: 0, unchanged: 0 },
        };
        const selectIdempotency = db.prepare(`
            SELECT idempotency_key
            FROM ingestion_idempotency
            WHERE message_id = ? AND attachment_hash = ? AND store_id = ? AND week_start = ?
        `);
        const selectSnapshotId = db.prepare(`
            SELECT id
            FROM campaign_snapshots
            WHERE store_id = ? AND week_start = ? AND campaign_id = ?
        `);
        const insertStep = db.prepare(`
            INSERT INTO automation_workflow_steps (
                id, run_id, step_key, attempt, status, started_at, completed_at, detail, error_message, metrics_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const syncStore = db.prepare(`
            INSERT INTO stores (id, name, email, doorDashAccountId, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = COALESCE(NULLIF(stores.name, ''), excluded.name),
                email = COALESCE(NULLIF(stores.email, ''), excluded.email),
                doorDashAccountId = COALESCE(NULLIF(stores.doorDashAccountId, ''), excluded.doorDashAccountId),
                updated_at = excluded.updated_at
        `);

        const tx = db.transaction(() => {
            const configuredStore = configuredProductionStores().find(store => store.id === input.store.id) || input.store;
            const timestamp = nowIso();
            syncStore.run(
                configuredStore.id,
                configuredStore.name,
                configuredStore.email,
                configuredStore.doorDashAccountId,
                configuredStore.active ? 1 : 0,
                timestamp,
                timestamp,
            );

            const existing = selectIdempotency.get(
                input.ingestionRecord.messageId,
                input.ingestionRecord.attachmentHash,
                input.ingestionRecord.storeId,
                input.ingestionRecord.weekStart,
            );
            if (existing) {
                result.alreadyProcessed = true;
                insertStep.run(
                    stableId('workflow-step', `${input.workflowRunId}|ingest_${input.store.id}|${input.ingestAttempt}|${timestamp}`),
                    input.workflowRunId,
                    `ingest_${input.store.id}`,
                    input.ingestAttempt,
                    'success',
                    timestamp,
                    timestamp,
                    `Report ${input.ingestionRecord.sourceRef} was already processed for ${input.store.id}.`,
                    null,
                    sanitizeJsonString(JSON.stringify({ alreadyProcessed: true })),
                );
                insertStep.run(
                    stableId('workflow-step', `${input.workflowRunId}|analyze_${input.store.id}|${input.analyzeAttempt}|${timestamp}`),
                    input.workflowRunId,
                    `analyze_${input.store.id}`,
                    input.analyzeAttempt,
                    'skipped',
                    timestamp,
                    timestamp,
                    `Recommendation persistence skipped because ${input.store.id} was already processed for ${input.ingestionRecord.weekStart}.`,
                    null,
                    sanitizeJsonString(JSON.stringify({ alreadyProcessed: true })),
                );
                return;
            }

            result.upsert = this.upsertSnapshotsSync(db, input.snapshots);
            const snapshotIdMap = new Map<string, string>();
            for (const snapshot of input.snapshots) {
                const row = selectSnapshotId.get(snapshot.storeId, snapshot.weekStart, snapshot.campaignId) as { id?: string } | undefined;
                if (row?.id) {
                    snapshotIdMap.set(snapshot.campaignId, row.id);
                }
            }

            for (const recommendation of input.recommendations) {
                const snapshotId = snapshotIdMap.get(input.snapshots.find(snapshot => snapshot.id === recommendation.campaignSnapshotId)?.campaignId || '')
                    || recommendation.campaignSnapshotId;
                this.saveRecommendationSync(db, {
                    ...recommendation,
                    campaignSnapshotId: snapshotId,
                });
            }

            db.prepare(`
                INSERT INTO review_packages (
                    id, workflow_run_id, store_id, week_start, provider, rule_version, package_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(store_id, week_start, provider) DO UPDATE SET
                    workflow_run_id = excluded.workflow_run_id,
                    rule_version = excluded.rule_version,
                    package_json = excluded.package_json,
                    created_at = excluded.created_at
            `).run(
                input.reviewPackage.id,
                input.reviewPackage.workflowRunId,
                input.reviewPackage.storeId,
                input.reviewPackage.weekStart,
                input.reviewPackage.provider,
                input.reviewPackage.ruleVersion,
                sanitizeJsonString(JSON.stringify(input.reviewPackage)),
                input.reviewPackage.createdAt,
            );

            db.prepare(`
                INSERT INTO ingestion_idempotency (
                    idempotency_key, message_id, attachment_hash, store_id, week_start, source_ref, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                input.ingestionRecord.idempotencyKey,
                input.ingestionRecord.messageId,
                input.ingestionRecord.attachmentHash,
                input.ingestionRecord.storeId,
                input.ingestionRecord.weekStart,
                input.ingestionRecord.sourceRef,
                input.ingestionRecord.createdAt,
            );

            insertStep.run(
                stableId('workflow-step', `${input.workflowRunId}|ingest_${input.store.id}|${input.ingestAttempt}|${timestamp}`),
                input.workflowRunId,
                `ingest_${input.store.id}`,
                input.ingestAttempt,
                'success',
                timestamp,
                timestamp,
                sanitizeErrorMessage(input.ingestDetail),
                null,
                sanitizeJsonString(input.ingestMetricsJson),
            );
            insertStep.run(
                stableId('workflow-step', `${input.workflowRunId}|analyze_${input.store.id}|${input.analyzeAttempt}|${timestamp}`),
                input.workflowRunId,
                `analyze_${input.store.id}`,
                input.analyzeAttempt,
                'success',
                timestamp,
                timestamp,
                sanitizeErrorMessage(input.analyzeDetail),
                null,
                sanitizeJsonString(input.analyzeMetricsJson),
            );
        });

        tx();
        return result;
    }

    private upsertSnapshotsSync(db: Database.Database, snapshots: WeeklyCampaignSnapshot[]): SnapshotUpsertResult {
        const result: SnapshotUpsertResult = { created: 0, updated: 0, unchanged: 0 };
        const selectExisting = db.prepare(`
            SELECT orders, sales, spend, roas, raw_data
            FROM campaign_snapshots
            WHERE store_id = ? AND week_start = ? AND campaign_id = ?
        `);
        const upsert = db.prepare(`
            INSERT INTO campaign_snapshots (
                id, store_id, campaign_id, campaign_name, campaign_type, status, budget, spend, sales, orders, roas, start_date, end_date,
                currency, raw_data, screenshot_path, snapshot_date, week_start, created_at, snapshot_source, source_ref, batch_id,
                report_start_date, report_end_date, data_completeness, updated_at, observed_date_start, observed_date_end
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(store_id, week_start, campaign_id) DO UPDATE SET
                status = excluded.status,
                spend = excluded.spend,
                sales = excluded.sales,
                orders = excluded.orders,
                roas = excluded.roas,
                raw_data = excluded.raw_data,
                snapshot_date = excluded.snapshot_date,
                created_at = campaign_snapshots.created_at,
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

        for (const snapshot of snapshots) {
            const existing = selectExisting.get(snapshot.storeId, snapshot.weekStart, snapshot.campaignId) as { orders: number; sales: number; spend: number; roas: number; raw_data: string } | undefined;
            upsert.run(
                snapshot.id,
                snapshot.storeId,
                snapshot.campaignId,
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

        return result;
    }

    private saveRecommendationSync(db: Database.Database, record: CampaignRecommendationRecord): void {
        db.prepare(`
            INSERT INTO recommendations (
                id, store_id, campaign_snapshot_id, recommendation_type, current_setting, proposed_setting,
                rule_id, rule_version, severity, detected_condition, supporting_metrics_json, expected_benefit,
                expected_roi_impact, expected_profit_impact, confidence, risk, reason, rollback_plan, human_approval_required,
                enrichment_status, status, created_at, provider, provider_model, week_start, raw_response_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(campaign_snapshot_id, provider, week_start, rule_id) DO UPDATE SET
                current_setting = excluded.current_setting,
                rule_version = excluded.rule_version,
                severity = excluded.severity,
                detected_condition = excluded.detected_condition,
                supporting_metrics_json = excluded.supporting_metrics_json,
                expected_benefit = excluded.expected_benefit,
                expected_roi_impact = excluded.expected_roi_impact,
                expected_profit_impact = excluded.expected_profit_impact,
                confidence = excluded.confidence,
                risk = excluded.risk,
                reason = excluded.reason,
                rollback_plan = excluded.rollback_plan,
                human_approval_required = excluded.human_approval_required,
                enrichment_status = excluded.enrichment_status,
                status = excluded.status,
                created_at = excluded.created_at,
                provider_model = excluded.provider_model,
                raw_response_json = excluded.raw_response_json
        `).run(
            record.id,
            record.storeId,
            record.campaignSnapshotId,
            record.recommendationType,
            record.currentSetting,
            record.proposedSetting,
            record.ruleId,
            record.ruleVersion,
            record.severity,
            record.detectedCondition,
            sanitizeJsonString(record.supportingMetricsJson),
            record.expectedBenefit,
            record.expectedRoiImpact,
            record.expectedProfitImpact,
            record.confidence,
            record.risk,
            record.reason,
            record.rollbackPlan,
            record.humanApprovalRequired ? 1 : 0,
            record.enrichmentStatus,
            record.status,
            record.createdAt,
            record.provider,
            record.model,
            record.weekStart,
            sanitizeJsonString(record.rawResponseJson),
        );
    }
}
