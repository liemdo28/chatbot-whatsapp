import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runWeeklyProductionWorkflow } from '../src/production/run-weekly-production.js';
import type { ProductionWorkflowConfig } from '../src/production/config.js';
import type { CampaignAnalysisInput, ProviderCampaignAnalysisResult } from '../src/production/types.js';
import type { CampaignAnalysisProvider } from '../src/production/analysis/provider.js';
import { SqliteProductionStorage } from '../src/production/storage/sqlite-production-storage.js';

class FakeCampaignAnalysisProvider implements CampaignAnalysisProvider {
    readonly providerName = 'rules';
    readonly providerModel = 'rules-v1';
    calls: CampaignAnalysisInput[] = [];

    async analyzeCampaign(input: CampaignAnalysisInput): Promise<ProviderCampaignAnalysisResult> {
        this.calls.push(input);
        return {
            provider: 'rules',
            model: 'rules-v1',
            summary: 'Fixture-backed rules response.',
            questions: [],
            recommendations: [{
                ruleId: input.snapshot.roas >= 3 ? 'keep' : 'request-more-data',
                ruleVersion: 'rules-v1',
                recommendationType: input.snapshot.roas >= 3 ? 'KEEP' : 'REQUEST_MORE_DATA',
                severity: 'low',
                detectedCondition: 'Fixture-backed production runner integration test.',
                currentSetting: `Spend $${input.snapshot.spend.toFixed(2)} | Sales $${input.snapshot.sales.toFixed(2)}`,
                proposedSetting: input.snapshot.roas >= 3 ? 'Maintain current settings' : 'Request more data',
                supportingMetrics: { roas: input.snapshot.roas },
                expectedBenefit: 'Keeps the test fixture deterministic.',
                expectedRoiImpact: 0,
                expectedProfitImpact: input.estimatedProfit,
                confidence: 0.82,
                risk: 'low',
                reason: 'Fixture-backed production runner integration test.',
                rollbackPlan: 'No rollback required for fixture validation.',
                humanApprovalRequired: false,
                missingData: [],
                enrichmentStatus: 'not_applicable',
                enrichmentNotes: null,
            }],
        };
    }
}

(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-runner-test-'));
    const diagnosticsDir = path.join(tempDir, 'artifacts');
    const dbPath = path.join(tempDir, 'runner.sqlite');
    const fixtureDir = path.resolve('data/fixtures/reports');

    const config: ProductionWorkflowConfig = {
        executionEnv: 'test',
        analysisProvider: 'rules',
        reportSource: 'fixture',
        storageBackend: 'sqlite',
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
        schedulerTimeZone: 'America/Los_Angeles',
        reportLookbackHours: 24,
        reportRetryAttempts: 2,
        reportRetryDelayMs: 1,
        reportDeliveryGraceHours: 36,
        reportAllowedSenders: ['reports@doordash.com'],
        reportSubjectIncludes: ['DoorDash', 'marketing report'],
        reportInboxLabel: 'INBOX',
        diagnosticsDir,
        sqliteDbPath: dbPath,
        postgresDatabaseUrl: '',
        fixtureReportDir: fixtureDir,
    };

    const provider = new FakeCampaignAnalysisProvider();
    const first = await runWeeklyProductionWorkflow({
        trigger: 'integration-test',
        storeIds: ['raw-sushi-bar'],
        weekStart: '2026-07-13',
        weekEndExclusive: '2026-07-20',
        configOverride: config,
        providerOverride: provider,
    });

    assert.equal(first.success, true);
    assert.equal(first.errors.length, 0);
    assert.equal(first.stores.length, 1);
    assert.ok(first.stores[0].recommendationCount > 0);
    assert.ok(fs.existsSync(first.diagnosticsPath));
    assert.ok(provider.calls.length > 0);

    const secondProvider = new FakeCampaignAnalysisProvider();
    const second = await runWeeklyProductionWorkflow({
        trigger: 'integration-test-repeat',
        storeIds: ['raw-sushi-bar'],
        weekStart: '2026-07-13',
        weekEndExclusive: '2026-07-20',
        configOverride: config,
        providerOverride: secondProvider,
    });

    assert.equal(second.success, true);
    assert.equal(second.stores.length, 1);
    assert.equal(second.stores[0].alreadyProcessed, true);

    const storage = new SqliteProductionStorage(dbPath);
    await storage.initialize();
    const snapshots = await storage.listSnapshotsForWeek('raw-sushi-bar', '2026-07-13');
    assert.ok(snapshots.length > 0);
    await storage.close();

    console.log('production-runner tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
