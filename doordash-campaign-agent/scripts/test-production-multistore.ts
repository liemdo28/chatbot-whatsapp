import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { createWeeklyReportingWindow, getCompletedWeeklyReportingWindow } from '../src/automation/weekly-reporting-window.js';
import type { ProductionWorkflowConfig } from '../src/production/config.js';
import { runWeeklyProductionWorkflow } from '../src/production/run-weekly-production.js';
import { discoverWeeklyReportsForStores } from '../src/production/reporting/report-ingestion-service.js';
import { resolveConfiguredProductionStore } from '../src/production/store-catalog.js';
import { SqliteProductionStorage } from '../src/production/storage/sqlite-production-storage.js';
import type { GmailInboxMessage } from '../src/integrations/email/gmail-inbox-client.js';

function createConfig(tempDir: string, dbPath: string): ProductionWorkflowConfig {
    return {
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
        storeTimeZoneConfigured: true,
        storeCurrencyConfigured: true,
        schedulerTimeZone: 'Asia/Ho_Chi_Minh',
        reportLookbackHours: 240,
        reportRetryAttempts: 1,
        reportRetryDelayMs: 1,
        reportDeliveryGraceHours: 36,
        reportAllowedSenders: ['reports@doordash.com'],
        reportSubjectIncludes: ['DoorDash', 'marketing report'],
        reportInboxLabel: 'INBOX',
        diagnosticsDir: path.join(tempDir, 'artifacts'),
        sqliteDbPath: dbPath,
        postgresDatabaseUrl: '',
        fixtureReportDir: path.join(tempDir, 'fixtures'),
    };
}

function requireStore(storeId: string) {
    const store = resolveConfiguredProductionStore(storeId);
    assert.ok(store, `missing store ${storeId}`);
    return store;
}

function createReportZip(outputPath: string, input: {
    storeId: string;
    storeName: string;
    weekStart: string;
    weekEndExclusive: string;
    campaignId: string;
    campaignName: string;
    sales?: number;
    spend?: number;
}): string {
    const zip = new AdmZip();
    const observedDates = [input.weekStart, input.weekEndExclusive];
    const csv = [
        'Date,Campaign ID,Campaign name,Store ID,Store name,Campaign start date,Campaign end date,Orders,Sales,Marketing fees | (including any applicable taxes),Customer discounts from marketing | (Funded by you),DoorDash marketing credit,Third-party contribution,Impressions,Clicks',
        ...observedDates.map(observedDate => (
            `${observedDate},${input.campaignId},${input.campaignName},${input.storeId},${input.storeName},${input.weekStart},None,10,${input.sales ?? 120},${input.spend ?? 20},0,0,0,1500,120`
        )),
    ].join('\n');
    zip.addFile('PROMOTION-performance.csv', Buffer.from(csv, 'utf8'));
    zip.writeZip(outputPath);
    return outputPath;
}

function buildMessage(messageId: string, subject: string, filePath: string): GmailInboxMessage {
    return {
        uid: Number(messageId.replace(/\D+/g, '') || '1'),
        messageId,
        subject,
        from: ['reports@doordash.com'],
        to: ['central@example.com'],
        receivedAt: new Date('2026-07-21T12:00:00.000Z').toISOString(),
        text: 'Weekly DoorDash marketing report attached.',
        attachments: [{
            filename: path.basename(filePath),
            contentType: 'application/zip',
            content: fs.readFileSync(filePath),
        }],
    };
}

(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-multistore-test-'));
    const dbPath = path.join(tempDir, 'multistore.sqlite');
    const fixtureDir = path.join(tempDir, 'fixtures');
    fs.mkdirSync(fixtureDir, { recursive: true });

    const raw = requireStore('raw-sushi-bar');
    const rim = requireStore('bakudan-the-rim');
    const stone = requireStore('bakudan-stone-oak');
    const bandera = requireStore('bakudan-bandera');
    const weekStart = '2026-07-13';
    const weekEndExclusive = '2026-07-20';

    const rawZip = createReportZip(path.join(fixtureDir, 'raw.zip'), {
        storeId: '892006',
        storeName: raw.displayName,
        weekStart,
        weekEndExclusive,
        campaignId: 'shared-campaign',
        campaignName: 'Raw Shared Campaign',
    });
    const rimZip = createReportZip(path.join(fixtureDir, 'rim.zip'), {
        storeId: '100002',
        storeName: rim.displayName,
        weekStart,
        weekEndExclusive,
        campaignId: 'shared-campaign',
        campaignName: 'Rim Shared Campaign',
    });
    const stoneZip = createReportZip(path.join(fixtureDir, 'stone.zip'), {
        storeId: '100003',
        storeName: stone.displayName,
        weekStart,
        weekEndExclusive,
        campaignId: 'shared-campaign',
        campaignName: 'Stone Shared Campaign',
    });
    const banderaZip = createReportZip(path.join(fixtureDir, 'bandera.zip'), {
        storeId: '100004',
        storeName: bandera.displayName,
        weekStart,
        weekEndExclusive,
        campaignId: 'shared-campaign',
        campaignName: 'Bandera Shared Campaign',
    });

    const allMessages = [
        buildMessage('message-1', `DoorDash marketing report ${raw.displayName}`, rawZip),
        buildMessage('message-2', `DoorDash marketing report ${rim.displayName}`, rimZip),
        buildMessage('message-3', `DoorDash marketing report ${stone.displayName}`, stoneZip),
        buildMessage('message-4', `DoorDash marketing report ${bandera.displayName}`, banderaZip),
    ];

    const config = createConfig(tempDir, dbPath);
    const storeOverrides = {
        'bakudan-the-rim': { doorDashAccountId: '100002', doorDashStoreId: '100002', timezone: 'America/Chicago', currency: 'USD' },
        'bakudan-stone-oak': { doorDashAccountId: '100003', doorDashStoreId: '100003', timezone: 'America/New_York', currency: 'USD' },
        'bakudan-bandera': { doorDashAccountId: '100004', doorDashStoreId: '100004', timezone: 'America/Denver', currency: 'USD' },
        'raw-sushi-bar': { timezone: 'America/Los_Angeles', currency: 'USD' },
    };

    const first = await runWeeklyProductionWorkflow({
        trigger: 'multistore-default',
        configOverride: config,
        fixtureMessages: allMessages,
        storeOverrides,
        now: new Date('2026-07-21T12:00:00.000Z'),
    });
    assert.equal(first.success, true);
    assert.equal(first.stores.length, 4);
    assert.equal(first.stores.every(store => store.status === 'analysis_complete'), true);
    assert.equal(first.stores.every(store => store.recommendationCount > 0), true);

    const second = await runWeeklyProductionWorkflow({
        trigger: 'multistore-default-rerun',
        configOverride: config,
        fixtureMessages: allMessages,
        storeOverrides,
        now: new Date('2026-07-21T12:00:00.000Z'),
    });
    assert.equal(second.success, true);
    assert.equal(second.stores.every(store => store.alreadyProcessed), true);

    const db = new Database(dbPath, { readonly: true });
    try {
        const snapshotCount = db.prepare('SELECT COUNT(*) AS count FROM campaign_snapshots').get() as { count: number };
        const recommendationCount = db.prepare('SELECT COUNT(*) AS count FROM recommendations').get() as { count: number };
        const idempotencyCount = db.prepare('SELECT COUNT(*) AS count FROM ingestion_idempotency').get() as { count: number };
        assert.equal(snapshotCount.count >= 4, true);
        assert.equal(recommendationCount.count >= 4, true);
        assert.equal(idempotencyCount.count, 4);
    } finally {
        db.close();
    }

    const singleStore = await runWeeklyProductionWorkflow({
        trigger: 'multistore-single-debug',
        storeIds: ['raw-sushi-bar'],
        weekStart,
        weekEndExclusive,
        configOverride: config,
        fixtureMessages: allMessages,
        storeOverrides,
        now: new Date('2026-07-21T12:00:00.000Z'),
    });
    assert.equal(singleStore.success, true);
    assert.equal(singleStore.stores.length, 1);
    assert.equal(singleStore.stores[0].storeId, 'raw-sushi-bar');

    const pending = await runWeeklyProductionWorkflow({
        trigger: 'multistore-missing-report',
        weekStart,
        weekEndExclusive,
        configOverride: config,
        fixtureMessages: allMessages.slice(0, 3),
        storeOverrides,
        now: new Date('2026-07-27T00:00:00.000Z'),
    });
    assert.equal(pending.success, false);
    assert.equal(pending.pendingExternalData, true);
    assert.equal(pending.stores.some(store => store.status === 'report_pending'), true);

    const approvalOnly = await runWeeklyProductionWorkflow({
        trigger: 'multistore-approval-rejection',
        storeIds: ['raw-sushi-bar'],
        weekStart,
        weekEndExclusive,
        configOverride: config,
        fixtureMessages: [{
            uid: 99,
            messageId: 'approval-message',
            subject: 'DoorDash Approval Needed - Raw Sushi Bar',
            from: ['reports@doordash.com'],
            to: ['central@example.com'],
            receivedAt: new Date('2026-07-21T12:00:00.000Z').toISOString(),
            text: 'DD APPROVE 123',
            attachments: [],
        }],
        storeOverrides,
        now: new Date('2026-07-28T18:06:00.000Z'),
    });
    assert.equal(approvalOnly.success, false);
    assert.equal(approvalOnly.stores[0].status, 'failed');

    const discoveryWindow = createWeeklyReportingWindow('America/Los_Angeles', weekStart, weekEndExclusive);
    const mismatchDiscovery = await discoverWeeklyReportsForStores({
        config,
        storeWindows: [{ store: { ...raw, ...storeOverrides['raw-sushi-bar'] }, window: discoveryWindow }],
        messages: [buildMessage('mismatch-message', `DoorDash marketing report ${raw.displayName}`, rimZip)],
        now: new Date('2026-07-21T12:00:00.000Z'),
    });
    assert.equal(mismatchDiscovery.stores[0].status, 'store_id_mismatch');

    const duplicateDiscovery = await discoverWeeklyReportsForStores({
        config,
        storeWindows: [{ store: { ...raw, ...storeOverrides['raw-sushi-bar'] }, window: discoveryWindow }],
        messages: [
            buildMessage('dup-1', `DoorDash marketing report ${raw.displayName}`, rawZip),
            buildMessage('dup-2', `DoorDash marketing report ${raw.displayName}`, rawZip),
        ],
        now: new Date('2026-07-21T12:00:00.000Z'),
    });
    assert.equal(duplicateDiscovery.stores[0].status, 'duplicate_report');

    const timezoneRun = await runWeeklyProductionWorkflow({
        trigger: 'multistore-timezones',
        configOverride: config,
        fixtureMessages: allMessages,
        storeOverrides,
        now: new Date('2026-07-22T12:00:00.000Z'),
    });
    assert.equal(timezoneRun.success, true);
    assert.equal(timezoneRun.stores.every(store => store.weekStart === '2026-07-13'), true);

    const approvalDiscovery = await discoverWeeklyReportsForStores({
        config,
        storeWindows: [{ store: { ...raw, ...storeOverrides['raw-sushi-bar'] }, window: discoveryWindow }],
        messages: [{
            uid: 100,
            messageId: 'approval-discovery',
            subject: 'DoorDash Approval Needed - Raw Sushi Bar',
            from: ['reports@doordash.com'],
            to: ['central@example.com'],
            receivedAt: new Date('2026-07-21T12:00:00.000Z').toISOString(),
            text: 'DD REJECT 123',
            attachments: [],
        }],
        now: new Date('2026-07-27T00:00:00.000Z'),
    });
    assert.equal(approvalDiscovery.rejectedCandidateCount, 1);
    assert.equal(approvalDiscovery.rejectionCategories.internal_approval, 1);
    assert.equal(approvalDiscovery.stores[0].status, 'report_pending');

    console.log('production-multistore tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
