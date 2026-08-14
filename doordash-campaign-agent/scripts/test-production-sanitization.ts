import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { runWeeklyProductionWorkflow } from '../src/production/run-weekly-production.js';
import { sanitizeSecretString } from '../src/production/security/error-sanitizer.js';
import type { ProductionWorkflowConfig } from '../src/production/config.js';
import type { CampaignAnalysisInput, ProviderRecommendation } from '../src/production/types.js';
import type { CampaignAnalysisProvider } from '../src/production/analysis/provider.js';

class SecretThrowingProvider implements CampaignAnalysisProvider {
    readonly providerName = 'openai';

    async analyzeCampaign(_input: CampaignAnalysisInput): Promise<ProviderRecommendation> {
        throw new Error('postgres://leaky-user:leaky-pass@localhost:5432/doordash?token=shhh sk-test-1234567890 Authorization: Bearer real-token');
    }
}

(async () => {
    const sanitized = sanitizeSecretString('DATABASE_URL=postgres://leaky-user:leaky-pass@localhost:5432/doordash?password=hunter2&token=shhh IMAP_PASS=supersecret sk-proj-secret Authorization: Bearer abc123');
    for (const forbidden of ['leaky-pass', 'hunter2', 'shhh', 'supersecret', 'abc123', 'sk-proj-secret']) {
        assert.equal(sanitized.includes(forbidden), false, `sanitized output still leaked ${forbidden}`);
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-sanitization-test-'));
    const diagnosticsDir = path.join(tempDir, 'artifacts');
    const dbPath = path.join(tempDir, 'sanitization.sqlite');
    const fixtureDir = path.resolve('data/fixtures/reports');

    const config: ProductionWorkflowConfig = {
        executionEnv: 'test',
        analysisProvider: 'openai',
        reportSource: 'fixture',
        storageBackend: 'sqlite',
        openAiApiKey: 'sk-test-synthetic',
        openAiModel: 'gpt-test',
        schedulerTimeZone: 'America/Los_Angeles',
        reportLookbackHours: 24,
        reportRetryAttempts: 1,
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

    const result = await runWeeklyProductionWorkflow({
        trigger: 'sanitization-test',
        storeIds: ['raw-sushi-bar'],
        weekStart: '2026-07-13',
        weekEndExclusive: '2026-07-20',
        configOverride: config,
        providerOverride: new SecretThrowingProvider(),
    });

    assert.equal(result.success, false);
    assert.ok(fs.existsSync(result.diagnosticsPath));
    const diagnosticsContent = fs.readFileSync(result.diagnosticsPath, 'utf8');
    for (const forbidden of ['leaky-pass', 'shhh', 'real-token', 'sk-test-1234567890']) {
        assert.equal(diagnosticsContent.includes(forbidden), false, `diagnostics leaked ${forbidden}`);
        assert.equal(result.errors.some(error => error.includes(forbidden)), false, `result.errors leaked ${forbidden}`);
    }

    const sqlite = new Database(dbPath, { readonly: true });
    const runRow = sqlite.prepare('SELECT summary, error_message, metadata_json FROM automation_workflow_runs ORDER BY started_at DESC LIMIT 1').get() as {
        summary: string | null;
        error_message: string | null;
        metadata_json: string | null;
    };
    assert.ok(runRow);
    for (const forbidden of ['leaky-pass', 'shhh', 'real-token', 'sk-test-1234567890']) {
        assert.equal((runRow.summary || '').includes(forbidden), false, `workflow summary leaked ${forbidden}`);
        assert.equal((runRow.error_message || '').includes(forbidden), false, `workflow error leaked ${forbidden}`);
        assert.equal((runRow.metadata_json || '').includes(forbidden), false, `workflow metadata leaked ${forbidden}`);
    }
    sqlite.close();

    console.log('production-sanitization tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
