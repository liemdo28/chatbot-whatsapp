import assert from 'node:assert/strict';
import type { ProductionWorkflowConfig } from '../src/production/config.js';
import { buildPublicWorkflowDiagnostics, type WeeklyProductionWorkflowResult } from '../src/production/run-weekly-production.js';

const config: ProductionWorkflowConfig = {
    executionEnv: 'production',
    analysisProvider: 'rules',
    reportSource: 'imap',
    storageBackend: 'postgres',
    openAiApiKey: '',
    openAiModel: '',
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
    diagnosticsDir: 'artifacts/weekly-production',
    sqliteDbPath: '',
    postgresDatabaseUrl: '',
    postgresDatabaseCaCert: '-----BEGIN CERTIFICATE-----\nSYNTHETIC-ROOT-CA\n-----END CERTIFICATE-----\n',
    postgresDatabaseCaCertPath: '/tmp/synthetic-ca.pem',
    fixtureReportDir: '',
};

const result: WeeklyProductionWorkflowResult = {
    success: false,
    pendingExternalData: false,
    failureCategory: 'hard_failure',
    workflowRunId: 'workflow-run-1',
    weekStart: '2026-07-13',
    weekEndExclusive: '2026-07-20',
    reportLabel: '07/13/2026 - 07/20/2026',
    summary: 'Weekly production workflow failed for 07/13/2026 - 07/20/2026.',
    diagnosticsPath: 'artifacts/weekly-production/workflow-run-1.json',
    stores: [{
        storeId: 'raw-sushi-bar',
        reportPath: 'raw-sushi-bar-marketing-report-2026-07-13.zip',
        recommendationCount: 3,
        alreadyProcessed: false,
        reviewPackagePath: 'artifacts/weekly-production/review-package.review-package.json',
    }],
    errors: [
        'raw-sushi-bar/Smart campaign: Spend $100.00 Sales $50.00 Maintain current settings',
    ],
};

const diagnostics = buildPublicWorkflowDiagnostics(result, config);
const serialized = JSON.stringify(diagnostics);

assert.equal(serialized.includes('Smart campaign'), false);
assert.equal(serialized.includes('Spend $100.00'), false);
assert.equal(serialized.includes('Maintain current settings'), false);
assert.equal(serialized.includes('reportPath'), false);
assert.equal(serialized.includes('reviewPackagePath'), false);
assert.equal(serialized.includes('raw-sushi-bar-marketing-report-2026-07-13.zip'), false);
assert.equal(serialized.includes('BEGIN CERTIFICATE'), false);
assert.equal(serialized.includes('SYNTHETIC-ROOT-CA'), false);
assert.equal(diagnostics.provider, 'rules');
assert.equal(diagnostics.ruleVersion, 'rules-v1');
assert.equal(diagnostics.recommendationCount, 3);

console.log('production-public-diagnostics tests passed');
