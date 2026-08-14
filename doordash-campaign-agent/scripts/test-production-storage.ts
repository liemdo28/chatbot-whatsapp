import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteProductionStorage } from '../src/production/storage/sqlite-production-storage.js';

(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-storage-test-'));
    const dbPath = path.join(tempDir, 'storage.sqlite');

    const storage = new SqliteProductionStorage(dbPath);
    await storage.initialize();

    const stores = await storage.listActiveStores(['raw-sushi-bar']);
    assert.equal(stores.length, 1);
    assert.equal(stores[0].doorDashAccountId, '900001');

    const run = await storage.createWorkflowRun({
        workflowName: 'test-run',
        trigger: 'unit',
        mode: 'fixture:openai:sqlite',
        timezone: 'America/Los_Angeles',
        weekStart: '2026-07-06',
        weekEndExclusive: '2026-07-13',
        metadataJson: '{"unit":true}',
    });
    assert.equal(run.status, 'running');

    await storage.recordWorkflowStep({
        runId: run.id,
        stepKey: 'unit_step',
        attempt: 1,
        status: 'success',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        detail: 'ok',
        errorMessage: null,
        metricsJson: '{"rows":1}',
    });

    const upsert = await storage.upsertSnapshots([{
        id: 'snapshot-1',
        storeId: 'raw-sushi-bar',
        campaignId: 'campaign-1',
        campaignName: 'Smart campaign 06/23/2026',
        campaignType: 'promotion',
        status: 'active',
        weekStart: '2026-07-06',
        weekEndExclusive: '2026-07-13',
        snapshotSource: 'email_export',
        sourceRef: 'fixture.zip',
        batchId: 'batch-1',
        reportStartDate: '07/06/2026',
        reportEndDate: '07/13/2026',
        observedDateStart: '2026-07-06',
        observedDateEnd: '2026-07-12',
        orders: 3,
        sales: 120,
        spend: 12,
        roas: 10,
        startDate: '2026-06-24',
        endDate: null,
        dataCompleteness: 4,
        rawDataJson: '{"campaign":{"campaignId":"campaign-1"}}',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }]);
    assert.equal(upsert.created, 1);

    await storage.saveIngestionRecord({
        idempotencyKey: 'idem-1',
        messageId: 'message-1',
        attachmentHash: 'hash-1',
        storeId: 'raw-sushi-bar',
        weekStart: '2026-07-06',
        sourceRef: 'fixture.zip',
        createdAt: new Date().toISOString(),
    });
    assert.equal(await storage.hasIngestionRecord('idem-1'), true);

    await storage.saveRecommendation({
        id: 'rec-1',
        storeId: 'raw-sushi-bar',
        campaignSnapshotId: 'snapshot-1',
        weekStart: '2026-07-06',
        provider: 'openai',
        model: 'test-model',
        recommendationType: 'KEEP',
        currentSetting: 'active',
        proposedSetting: 'Maintain current settings',
        expectedRoiImpact: 0,
        expectedProfitImpact: 0,
        confidence: 0.8,
        risk: 'low',
        reason: 'Stable performance.',
        rollbackPlan: 'No rollback required.',
        rawResponseJson: '{"ok":true}',
        status: 'pending',
        createdAt: new Date().toISOString(),
    });

    await storage.completeWorkflowRun(run.id, 'done', '{"done":true}');
    await storage.close();
    console.log('production-storage tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
