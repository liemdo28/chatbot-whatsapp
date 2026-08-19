import assert from 'node:assert/strict';
import crypto from 'crypto';
import path from 'path';
import { Pool } from 'pg';
import { runWeeklyProductionWorkflow } from '../src/production/run-weekly-production.js';
import { PostgresProductionStorage } from '../src/production/storage/postgres-production-storage.js';
import { sanitizeErrorMessage } from '../src/production/security/error-sanitizer.js';
import type { ProductionWorkflowConfig } from '../src/production/config.js';
import type { CampaignAnalysisInput, ProviderCampaignAnalysisResult } from '../src/production/types.js';
import type { CampaignAnalysisProvider } from '../src/production/analysis/provider.js';

class FakeCampaignAnalysisProvider implements CampaignAnalysisProvider {
    readonly providerName = 'rules';
    readonly providerModel = 'rules-v1';

    async analyzeCampaign(input: CampaignAnalysisInput): Promise<ProviderCampaignAnalysisResult> {
        return {
            provider: 'rules',
            model: 'rules-v1',
            summary: 'Postgres integration validation.',
            questions: [],
            recommendations: [{
                ruleId: input.snapshot.roas >= 3 ? 'keep' : 'request-more-data',
                ruleVersion: 'rules-v1',
                recommendationType: input.snapshot.roas >= 3 ? 'KEEP' : 'REQUEST_MORE_DATA',
                severity: 'low',
                detectedCondition: 'Postgres integration validation.',
                currentSetting: `Spend $${input.snapshot.spend.toFixed(2)} | Sales $${input.snapshot.sales.toFixed(2)}`,
                proposedSetting: input.snapshot.roas >= 3 ? 'Maintain current settings' : 'Request more data',
                supportingMetrics: { roas: input.snapshot.roas },
                expectedBenefit: 'Keeps the integration test deterministic.',
                expectedRoiImpact: 0,
                expectedProfitImpact: input.estimatedProfit,
                confidence: 0.82,
                risk: 'low',
                reason: 'Postgres integration validation.',
                rollbackPlan: 'No rollback required for fixture validation.',
                humanApprovalRequired: false,
                missingData: [],
                enrichmentStatus: 'not_applicable',
                enrichmentNotes: null,
            }],
        };
    }
}

function requireDatabaseUrl(): string {
    const databaseUrl = process.env['DATABASE_URL'] || '';
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is required for test:production-postgres.');
    }
    return databaseUrl;
}

function randomSchemaName(): string {
    return `dd_prod_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function countQuery(schemaName: string, tableName: string): string {
    return `SELECT COUNT(*)::int AS count FROM "${schemaName}"."${tableName}"`;
}

async function readCount(pool: Pool, schemaName: string, tableName: string): Promise<number> {
    const result = await pool.query<{ count: number }>(countQuery(schemaName, tableName));
    return Number(result.rows[0]?.count || 0);
}

async function readMigrationVersions(pool: Pool, schemaName: string): Promise<string[]> {
    const result = await pool.query<{ version: string }>(
        `SELECT version FROM "${schemaName}".schema_migrations ORDER BY version ASC`,
    );
    return result.rows.map(row => row.version);
}

function createConfig(schemaName: string, databaseUrl: string): ProductionWorkflowConfig {
    return {
        executionEnv: 'test',
        analysisProvider: 'rules',
        reportSource: 'fixture',
        storageBackend: 'postgres',
        openAiApiKey: '',
        openAiModel: 'gpt-test',
        rules: {
            ruleVersion: 'rules-v1',
            minAcceptableRoas: 3,
            maxAcceptableCpa: 25,
            minimumSpendForJudgement: 25,
            minimumImpressionsForConfidence: 1000,
            minimumClicksForConfidence: 25,
            deteriorationThresholdPct: 0.2,
            budgetIncreaseCeilingPct: 0.2,
            storeCurrency: 'USD',
            storeTimeZone: 'America/Los_Angeles',
        },
        storeTimeZoneConfigured: true,
        storeCurrencyConfigured: true,
        schedulerTimeZone: 'Asia/Ho_Chi_Minh',
        reportLookbackHours: 24,
        reportRetryAttempts: 1,
        reportRetryDelayMs: 1,
        reportDeliveryGraceHours: 36,
        reportAllowedSenders: ['reports@doordash.com'],
        reportSubjectIncludes: ['DoorDash', 'marketing report'],
        reportInboxLabel: 'INBOX',
        diagnosticsDir: path.resolve('artifacts', 'weekly-production', schemaName),
        sqliteDbPath: '',
        postgresDatabaseUrl: databaseUrl,
        fixtureReportDir: path.resolve('data/fixtures/reports'),
    };
}

function createStorage(databaseUrl: string, schemaName: string, shouldFailMidTransaction: boolean = false): PostgresProductionStorage {
    return new PostgresProductionStorage(databaseUrl, {
        poolConfig: {
            options: `-c search_path=${schemaName},public`,
        },
        hooks: shouldFailMidTransaction
            ? {
                async beforePersistIngestionRecord() {
                    throw new Error('synthetic rollback test postgres://rollback-user:rollback-pass@localhost:5432/test?token=should-hide');
                },
            }
            : undefined,
    });
}

(async () => {
    const databaseUrl = requireDatabaseUrl();
    const adminPool = new Pool({ connectionString: databaseUrl, max: 1, allowExitOnIdle: true });
    const primarySchemaName = randomSchemaName();
    const concurrentSchemaName = randomSchemaName();
    const rollbackSchemaName = randomSchemaName();
    await adminPool.query(`CREATE SCHEMA "${primarySchemaName}"`);
    await adminPool.query(`CREATE SCHEMA "${concurrentSchemaName}"`);
    await adminPool.query(`CREATE SCHEMA "${rollbackSchemaName}"`);

    try {
        const config = createConfig(primarySchemaName, databaseUrl);
        const provider = new FakeCampaignAnalysisProvider();

        const migrationStorageA = createStorage(databaseUrl, primarySchemaName);
        const migrationStorageB = createStorage(databaseUrl, primarySchemaName);
        await Promise.all([migrationStorageA.initialize(), migrationStorageB.initialize()]);
        await Promise.all([migrationStorageA.close(), migrationStorageB.close()]);

        const migrationVersions = await readMigrationVersions(adminPool, primarySchemaName);
        assert.equal(
            new Set(migrationVersions).size,
            migrationVersions.length,
            'expected schema_migrations to contain each migration version at most once after rerunnable initialize',
        );
        assert.ok(
            migrationVersions.includes('001_weekly_production_foundation'),
            'expected foundation migration to be recorded after rerunnable initialize',
        );
        assert.ok(
            migrationVersions.includes('002_rules_review_packages'),
            'expected review package migration to be recorded after rerunnable initialize',
        );

        const first = await runWeeklyProductionWorkflow({
            trigger: 'postgres-integration',
            storeIds: ['raw-sushi-bar'],
            weekStart: '2026-07-13',
            weekEndExclusive: '2026-07-20',
            configOverride: config,
            providerOverride: provider,
            storageOverride: createStorage(databaseUrl, primarySchemaName),
        });
        assert.equal(first.success, true);
        assert.equal(first.stores.length, 1);
        assert.equal(first.stores[0].alreadyProcessed, false);

        const second = await runWeeklyProductionWorkflow({
            trigger: 'postgres-repeat',
            storeIds: ['raw-sushi-bar'],
            weekStart: '2026-07-13',
            weekEndExclusive: '2026-07-20',
            configOverride: config,
            providerOverride: new FakeCampaignAnalysisProvider(),
            storageOverride: createStorage(databaseUrl, primarySchemaName),
        });
        assert.equal(second.success, true);
        assert.equal(second.stores[0].alreadyProcessed, true);

        assert.ok(await readCount(adminPool, primarySchemaName, 'campaign_snapshots') > 0);
        assert.ok(await readCount(adminPool, primarySchemaName, 'recommendations') > 0);
        assert.equal(await readCount(adminPool, primarySchemaName, 'review_packages'), 1);
        assert.equal(await readCount(adminPool, primarySchemaName, 'ingestion_idempotency'), 1);

        const concurrentConfig = createConfig(concurrentSchemaName, databaseUrl);
        const concurrentStorageA = createStorage(databaseUrl, concurrentSchemaName);
        const concurrentStorageB = createStorage(databaseUrl, concurrentSchemaName);

        const concurrentResults = await Promise.all([
            runWeeklyProductionWorkflow({
                trigger: 'postgres-concurrent-a',
                storeIds: ['raw-sushi-bar'],
                weekStart: '2026-07-13',
                weekEndExclusive: '2026-07-20',
                configOverride: concurrentConfig,
                providerOverride: new FakeCampaignAnalysisProvider(),
                storageOverride: concurrentStorageA,
            }),
            runWeeklyProductionWorkflow({
                trigger: 'postgres-concurrent-b',
                storeIds: ['raw-sushi-bar'],
                weekStart: '2026-07-13',
                weekEndExclusive: '2026-07-20',
                configOverride: concurrentConfig,
                providerOverride: new FakeCampaignAnalysisProvider(),
                storageOverride: concurrentStorageB,
            }),
        ]);
        assert.equal(concurrentResults.every(result => result.success), true);
        const concurrentProcessedFlags = concurrentResults.map(result => result.stores[0]?.alreadyProcessed).sort();
        assert.deepEqual(concurrentProcessedFlags, [false, true]);

        const postConcurrentIdempotency = await adminPool.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM "${concurrentSchemaName}".ingestion_idempotency WHERE week_start = $1`,
            ['2026-07-13'],
        );
        assert.equal(Number(postConcurrentIdempotency.rows[0]?.count || 0), 1);

        const rollbackConfig = createConfig(rollbackSchemaName, databaseUrl);
        const rollbackMigrationStorage = createStorage(databaseUrl, rollbackSchemaName);
        await rollbackMigrationStorage.initialize();
        await rollbackMigrationStorage.close();
        const beforeRollbackSnapshots = await adminPool.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM "${rollbackSchemaName}".campaign_snapshots WHERE week_start = $1`,
            ['2026-07-13'],
        );
        assert.equal(Number(beforeRollbackSnapshots.rows[0]?.count || 0), 0);

        const rollbackResult = await runWeeklyProductionWorkflow({
            trigger: 'postgres-rollback',
            storeIds: ['raw-sushi-bar'],
            weekStart: '2026-07-13',
            weekEndExclusive: '2026-07-20',
            configOverride: rollbackConfig,
            providerOverride: new FakeCampaignAnalysisProvider(),
            storageOverride: createStorage(databaseUrl, rollbackSchemaName, true),
        });
        assert.equal(rollbackResult.success, false);
        const rollbackError = rollbackResult.errors.join(' | ');
        assert.equal(rollbackError.includes('rollback-pass'), false);
        assert.equal(rollbackError.includes('should-hide'), false);
        assert.ok(sanitizeErrorMessage('postgres://rollback-user:rollback-pass@localhost:5432/test?token=should-hide').includes('<redacted>'));

        const afterRollbackSnapshots = await adminPool.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM "${rollbackSchemaName}".campaign_snapshots WHERE week_start = $1`,
            ['2026-07-13'],
        );
        const afterRollbackRecommendations = await adminPool.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM "${rollbackSchemaName}".recommendations recommendation
             JOIN "${rollbackSchemaName}".campaign_snapshots snapshot ON snapshot.id = recommendation.campaign_snapshot_id
             WHERE snapshot.week_start = $1`,
            ['2026-07-13'],
        );
        const afterRollbackIdempotency = await adminPool.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM "${rollbackSchemaName}".ingestion_idempotency WHERE week_start = $1`,
            ['2026-07-13'],
        );
        const afterRollbackReviewPackages = await adminPool.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM "${rollbackSchemaName}".review_packages WHERE week_start = $1`,
            ['2026-07-13'],
        );
        assert.equal(Number(afterRollbackSnapshots.rows[0]?.count || 0), 0);
        assert.equal(Number(afterRollbackRecommendations.rows[0]?.count || 0), 0);
        assert.equal(Number(afterRollbackIdempotency.rows[0]?.count || 0), 0);
        assert.equal(Number(afterRollbackReviewPackages.rows[0]?.count || 0), 0);

        console.log('production-postgres tests passed');
    } finally {
        await adminPool.query(`DROP SCHEMA IF EXISTS "${primarySchemaName}" CASCADE`);
        await adminPool.query(`DROP SCHEMA IF EXISTS "${concurrentSchemaName}" CASCADE`);
        await adminPool.query(`DROP SCHEMA IF EXISTS "${rollbackSchemaName}" CASCADE`);
        await adminPool.end();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
