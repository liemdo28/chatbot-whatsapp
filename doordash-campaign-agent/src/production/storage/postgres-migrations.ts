import type { Pool, PoolClient } from 'pg';

const MIGRATION_LOCK_ID = '871642193510244211';

interface PostgresMigration {
    version: string;
    up(client: PoolClient): Promise<void>;
}

async function executeStatements(client: PoolClient, statements: string[]): Promise<void> {
    for (const statement of statements) {
        await client.query(statement);
    }
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

const migrations: PostgresMigration[] = [
    {
        version: '001_weekly_production_foundation',
        async up(client: PoolClient): Promise<void> {
            await executeStatements(client, [
                `
                CREATE OR REPLACE FUNCTION jsonb_extract_text_safe(payload TEXT, VARIADIC keys TEXT[])
                RETURNS TEXT
                LANGUAGE plpgsql
                AS $$
                DECLARE
                    current_value JSONB;
                    key_name TEXT;
                BEGIN
                    IF payload IS NULL OR btrim(payload) = '' THEN
                        RETURN NULL;
                    END IF;

                    current_value := payload::jsonb;
                    FOREACH key_name IN ARRAY keys LOOP
                        IF current_value IS NULL THEN
                            RETURN NULL;
                        END IF;
                        current_value := current_value -> key_name;
                    END LOOP;

                    IF current_value IS NULL THEN
                        RETURN NULL;
                    END IF;

                    RETURN trim(both '"' FROM current_value::TEXT);
                EXCEPTION
                    WHEN others THEN
                        RETURN NULL;
                END;
                $$;
                `,
                `
                CREATE TABLE IF NOT EXISTS stores (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    "doorDashAccountId" TEXT,
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                `,
                `
                CREATE TABLE IF NOT EXISTS automation_workflow_runs (
                    id TEXT PRIMARY KEY,
                    workflow_name TEXT NOT NULL,
                    trigger TEXT NOT NULL,
                    scope TEXT NOT NULL DEFAULT 'weekly_production',
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
                )
                `,
                `
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
                )
                `,
                `
                CREATE TABLE IF NOT EXISTS campaign_snapshots (
                    id TEXT PRIMARY KEY,
                    store_id TEXT NOT NULL,
                    campaign_id TEXT,
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
                    currency TEXT NOT NULL DEFAULT 'USD',
                    raw_data TEXT NOT NULL,
                    snapshot_date TIMESTAMPTZ NOT NULL,
                    week_start TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    snapshot_source TEXT NOT NULL DEFAULT 'email_export',
                    source_ref TEXT NOT NULL DEFAULT '',
                    batch_id TEXT NOT NULL DEFAULT '',
                    report_start_date TEXT NOT NULL DEFAULT '',
                    report_end_date TEXT NOT NULL DEFAULT '',
                    data_completeness INTEGER NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    observed_date_start TEXT NOT NULL DEFAULT '',
                    observed_date_end TEXT NOT NULL DEFAULT ''
                )
                `,
                `
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
                    provider TEXT NOT NULL DEFAULT 'openai',
                    provider_model TEXT NOT NULL DEFAULT 'unknown',
                    week_start TEXT,
                    raw_response_json TEXT NOT NULL DEFAULT '{}'
                )
                `,
                `
                CREATE TABLE IF NOT EXISTS ingestion_idempotency (
                    idempotency_key TEXT PRIMARY KEY,
                    message_id TEXT NOT NULL,
                    attachment_hash TEXT NOT NULL,
                    store_id TEXT NOT NULL,
                    week_start TEXT NOT NULL,
                    source_ref TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL
                )
                `,
                `ALTER TABLE automation_workflow_runs ADD COLUMN IF NOT EXISTS scope TEXT`,
                `ALTER TABLE campaign_snapshots ADD COLUMN IF NOT EXISTS campaign_id TEXT`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS provider TEXT`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS provider_model TEXT`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS week_start TEXT`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS raw_response_json TEXT`,
                `
                UPDATE automation_workflow_runs
                SET scope = COALESCE(NULLIF(scope, ''), 'weekly_production')
                WHERE scope IS NULL OR scope = ''
                `,
                `
                UPDATE campaign_snapshots
                SET
                    campaign_id = COALESCE(NULLIF(campaign_id, ''), jsonb_extract_text_safe(raw_data, 'campaign', 'campaignId'), id),
                    snapshot_source = COALESCE(NULLIF(snapshot_source, ''), 'email_export'),
                    source_ref = COALESCE(source_ref, ''),
                    batch_id = COALESCE(batch_id, ''),
                    report_start_date = COALESCE(report_start_date, ''),
                    report_end_date = COALESCE(report_end_date, ''),
                    data_completeness = COALESCE(data_completeness, 0),
                    updated_at = COALESCE(updated_at, created_at, snapshot_date, NOW()),
                    observed_date_start = COALESCE(observed_date_start, ''),
                    observed_date_end = COALESCE(observed_date_end, ''),
                    currency = COALESCE(NULLIF(currency, ''), 'USD')
                `,
                `
                UPDATE recommendations recommendation
                SET
                    provider = COALESCE(NULLIF(recommendation.provider, ''), 'openai'),
                    provider_model = COALESCE(NULLIF(recommendation.provider_model, ''), 'unknown'),
                    week_start = COALESCE(NULLIF(recommendation.week_start, ''), snapshot.week_start),
                    raw_response_json = COALESCE(NULLIF(recommendation.raw_response_json, ''), '{}'),
                    status = COALESCE(NULLIF(recommendation.status, ''), 'pending')
                FROM campaign_snapshots snapshot
                WHERE snapshot.id = recommendation.campaign_snapshot_id
                `,
                `
                WITH ranked AS (
                    SELECT ctid,
                           ROW_NUMBER() OVER (
                               PARTITION BY store_id, week_start, COALESCE(NULLIF(campaign_id, ''), id)
                               ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                           ) AS row_number
                    FROM campaign_snapshots
                )
                DELETE FROM campaign_snapshots target
                USING ranked
                WHERE target.ctid = ranked.ctid
                  AND ranked.row_number > 1
                `,
                `
                WITH ranked AS (
                    SELECT ctid,
                           ROW_NUMBER() OVER (
                               PARTITION BY message_id, attachment_hash, store_id, week_start
                               ORDER BY created_at DESC NULLS LAST, idempotency_key DESC
                           ) AS row_number
                    FROM ingestion_idempotency
                )
                DELETE FROM ingestion_idempotency target
                USING ranked
                WHERE target.ctid = ranked.ctid
                  AND ranked.row_number > 1
                `,
                `
                WITH ranked AS (
                    SELECT ctid,
                           ROW_NUMBER() OVER (
                               PARTITION BY campaign_snapshot_id, provider, week_start, recommendation_type, proposed_setting
                               ORDER BY created_at DESC NULLS LAST, id DESC
                           ) AS row_number
                    FROM recommendations
                )
                DELETE FROM recommendations target
                USING ranked
                WHERE target.ctid = ranked.ctid
                  AND ranked.row_number > 1
                `,
                `ALTER TABLE automation_workflow_runs ALTER COLUMN scope SET NOT NULL`,
                `ALTER TABLE campaign_snapshots ALTER COLUMN campaign_id SET NOT NULL`,
                `ALTER TABLE campaign_snapshots ALTER COLUMN snapshot_source SET NOT NULL`,
                `ALTER TABLE campaign_snapshots ALTER COLUMN source_ref SET NOT NULL`,
                `ALTER TABLE campaign_snapshots ALTER COLUMN batch_id SET NOT NULL`,
                `ALTER TABLE campaign_snapshots ALTER COLUMN report_start_date SET NOT NULL`,
                `ALTER TABLE campaign_snapshots ALTER COLUMN report_end_date SET NOT NULL`,
                `ALTER TABLE campaign_snapshots ALTER COLUMN data_completeness SET NOT NULL`,
                `ALTER TABLE campaign_snapshots ALTER COLUMN updated_at SET NOT NULL`,
                `ALTER TABLE campaign_snapshots ALTER COLUMN observed_date_start SET NOT NULL`,
                `ALTER TABLE campaign_snapshots ALTER COLUMN observed_date_end SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN provider SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN provider_model SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN week_start SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN raw_response_json SET NOT NULL`,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'automation_workflow_steps'::regclass
                          AND conname = 'fk_workflow_steps_run'
                    ) THEN
                        ALTER TABLE automation_workflow_steps
                        ADD CONSTRAINT fk_workflow_steps_run
                        FOREIGN KEY (run_id)
                        REFERENCES automation_workflow_runs(id)
                        ON DELETE CASCADE;
                    END IF;
                END $$;
                `,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'campaign_snapshots'::regclass
                          AND conname = 'fk_campaign_snapshots_store'
                    ) THEN
                        ALTER TABLE campaign_snapshots
                        ADD CONSTRAINT fk_campaign_snapshots_store
                        FOREIGN KEY (store_id)
                        REFERENCES stores(id)
                        ON DELETE RESTRICT;
                    END IF;
                END $$;
                `,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'recommendations'::regclass
                          AND conname = 'fk_recommendations_store'
                    ) THEN
                        ALTER TABLE recommendations
                        ADD CONSTRAINT fk_recommendations_store
                        FOREIGN KEY (store_id)
                        REFERENCES stores(id)
                        ON DELETE RESTRICT;
                    END IF;
                END $$;
                `,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'recommendations'::regclass
                          AND conname = 'fk_recommendations_snapshot'
                    ) THEN
                        ALTER TABLE recommendations
                        ADD CONSTRAINT fk_recommendations_snapshot
                        FOREIGN KEY (campaign_snapshot_id)
                        REFERENCES campaign_snapshots(id)
                        ON DELETE CASCADE;
                    END IF;
                END $$;
                `,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'ingestion_idempotency'::regclass
                          AND conname = 'fk_ingestion_store'
                    ) THEN
                        ALTER TABLE ingestion_idempotency
                        ADD CONSTRAINT fk_ingestion_store
                        FOREIGN KEY (store_id)
                        REFERENCES stores(id)
                        ON DELETE RESTRICT;
                    END IF;
                END $$;
                `,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'campaign_snapshots'::regclass
                          AND conname = 'uq_campaign_snapshots_store_week_campaign'
                    ) THEN
                        ALTER TABLE campaign_snapshots
                        ADD CONSTRAINT uq_campaign_snapshots_store_week_campaign
                        UNIQUE (store_id, week_start, campaign_id);
                    END IF;
                END $$;
                `,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'ingestion_idempotency'::regclass
                          AND conname = 'uq_ingestion_identity_message_attachment_store_week'
                    ) THEN
                        ALTER TABLE ingestion_idempotency
                        ADD CONSTRAINT uq_ingestion_identity_message_attachment_store_week
                        UNIQUE (message_id, attachment_hash, store_id, week_start);
                    END IF;
                END $$;
                `,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'recommendations'::regclass
                          AND conname = 'uq_recommendations_idempotent'
                    ) THEN
                        ALTER TABLE recommendations
                        ADD CONSTRAINT uq_recommendations_idempotent
                        UNIQUE (campaign_snapshot_id, provider, week_start, recommendation_type, proposed_setting);
                    END IF;
                END $$;
                `,
                `CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_store_week ON campaign_snapshots(store_id, week_start, updated_at DESC)`,
                `CREATE INDEX IF NOT EXISTS idx_recommendations_store_week ON recommendations(store_id, week_start, created_at DESC)`,
                `CREATE INDEX IF NOT EXISTS idx_workflow_runs_name_started ON automation_workflow_runs(workflow_name, started_at DESC)`,
                `CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_started ON automation_workflow_runs(status, started_at DESC)`,
                `CREATE INDEX IF NOT EXISTS idx_workflow_steps_run_status_started ON automation_workflow_steps(run_id, status, started_at DESC)`,
                `CREATE INDEX IF NOT EXISTS idx_ingestion_store_week ON ingestion_idempotency(store_id, week_start, created_at DESC)`,
            ]);
        },
    },
    {
        version: '002_rules_review_packages',
        async up(client: PoolClient): Promise<void> {
            await executeStatements(client, [
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS rule_id TEXT`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS rule_version TEXT`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS severity TEXT`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS detected_condition TEXT`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS supporting_metrics_json TEXT`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS expected_benefit TEXT`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS human_approval_required BOOLEAN`,
                `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS enrichment_status TEXT`,
                `
                UPDATE recommendations
                SET
                    rule_id = COALESCE(NULLIF(rule_id, ''), lower(regexp_replace(COALESCE(recommendation_type, 'keep'), '[^a-zA-Z0-9]+', '-', 'g'))),
                    rule_version = COALESCE(NULLIF(rule_version, ''), 'legacy-openai'),
                    severity = COALESCE(NULLIF(severity, ''), CASE
                        WHEN risk = 'high' THEN 'high'
                        WHEN risk = 'medium' THEN 'medium'
                        ELSE 'low'
                    END),
                    detected_condition = COALESCE(NULLIF(detected_condition, ''), reason),
                    supporting_metrics_json = COALESCE(NULLIF(supporting_metrics_json, ''), '{}'),
                    expected_benefit = COALESCE(NULLIF(expected_benefit, ''), proposed_setting),
                    human_approval_required = COALESCE(human_approval_required, recommendation_type NOT IN ('KEEP', 'REQUEST_MORE_DATA')),
                    enrichment_status = COALESCE(NULLIF(enrichment_status, ''), 'not_applicable')
                `,
                `ALTER TABLE recommendations ALTER COLUMN rule_id SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN rule_version SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN severity SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN detected_condition SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN supporting_metrics_json SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN expected_benefit SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN human_approval_required SET NOT NULL`,
                `ALTER TABLE recommendations ALTER COLUMN enrichment_status SET NOT NULL`,
                `
                CREATE TABLE IF NOT EXISTS review_packages (
                    id TEXT PRIMARY KEY,
                    workflow_run_id TEXT NOT NULL,
                    store_id TEXT NOT NULL,
                    week_start TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    rule_version TEXT NOT NULL,
                    package_json TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL
                )
                `,
                `
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'recommendations'::regclass
                          AND conname = 'uq_recommendations_idempotent'
                    ) THEN
                        ALTER TABLE recommendations DROP CONSTRAINT uq_recommendations_idempotent;
                    END IF;
                END $$;
                `,
                `
                WITH ranked AS (
                    SELECT ctid,
                           ROW_NUMBER() OVER (
                               PARTITION BY campaign_snapshot_id, provider, week_start, rule_id
                               ORDER BY created_at DESC NULLS LAST, id DESC
                           ) AS row_number
                    FROM recommendations
                )
                DELETE FROM recommendations target
                USING ranked
                WHERE target.ctid = ranked.ctid
                  AND ranked.row_number > 1
                `,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'recommendations'::regclass
                          AND conname = 'uq_recommendations_idempotent_v2'
                    ) THEN
                        ALTER TABLE recommendations
                        ADD CONSTRAINT uq_recommendations_idempotent_v2
                        UNIQUE (campaign_snapshot_id, provider, week_start, rule_id);
                    END IF;
                END $$;
                `,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'review_packages'::regclass
                          AND conname = 'fk_review_packages_store'
                    ) THEN
                        ALTER TABLE review_packages
                        ADD CONSTRAINT fk_review_packages_store
                        FOREIGN KEY (store_id)
                        REFERENCES stores(id)
                        ON DELETE RESTRICT;
                    END IF;
                END $$;
                `,
                `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'review_packages'::regclass
                          AND conname = 'fk_review_packages_run'
                    ) THEN
                        ALTER TABLE review_packages
                        ADD CONSTRAINT fk_review_packages_run
                        FOREIGN KEY (workflow_run_id)
                        REFERENCES automation_workflow_runs(id)
                        ON DELETE CASCADE;
                    END IF;
                END $$;
                `,
                `CREATE UNIQUE INDEX IF NOT EXISTS uq_review_packages_store_week_provider ON review_packages(store_id, week_start, provider)`,
                `CREATE INDEX IF NOT EXISTS idx_review_packages_store_week ON review_packages(store_id, week_start, created_at DESC)`,
            ]);
        },
    },
];

export async function runPostgresMigrations(pool: Pool): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_ID]);
        await ensureMigrationTable(client);
        const applied = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
        const appliedVersions = new Set(applied.rows.map(row => row.version));

        for (const migration of migrations) {
            if (appliedVersions.has(migration.version)) {
                continue;
            }

            try {
                await client.query('BEGIN');
                await migration.up(client);
                await client.query(
                    'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW()) ON CONFLICT (version) DO NOTHING',
                    [migration.version],
                );
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
    } finally {
        try {
            await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_ID]);
        } finally {
            client.release();
        }
    }
}
