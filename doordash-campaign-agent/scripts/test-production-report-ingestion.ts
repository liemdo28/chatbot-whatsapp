import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { SqliteProductionStorage } from '../src/production/storage/sqlite-production-storage.js';
import { ingestWeeklyReportForStore } from '../src/production/reporting/report-ingestion-service.js';
import { ReportAuthenticationError, ReportInboxUnavailableError } from '../src/production/reporting/report-ingestion-errors.js';
import type { ProductionWorkflowConfig } from '../src/production/config.js';
import { GmailInboxClient, ImapAuthenticationError, ImapConnectionError, type GmailInboxMessage } from '../src/integrations/email/gmail-inbox-client.js';

(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-ingestion-test-'));
    const diagnosticsDir = path.join(tempDir, 'artifacts');
    const storage = new SqliteProductionStorage(path.join(tempDir, 'ingestion.sqlite'));
    await storage.initialize();

    const stores = await storage.listActiveStores(['raw-sushi-bar', 'bakudan-the-rim']);
    const store = stores.find(item => item.id === 'raw-sushi-bar');
    const mismatchStore = stores.find(item => item.id === 'bakudan-the-rim');
    assert.ok(store);
    assert.ok(mismatchStore);
    const validFixture = path.resolve('data/fixtures/reports/raw-sushi-bar-marketing-report-2026-07-13.zip');
    const config: ProductionWorkflowConfig = {
        executionEnv: 'test',
        analysisProvider: 'openai',
        reportSource: 'fixture',
        storageBackend: 'sqlite',
        openAiApiKey: 'test',
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
        reportRetryAttempts: 2,
        reportRetryDelayMs: 1,
        reportDeliveryGraceHours: 36,
        reportAllowedSenders: ['reports@doordash.com'],
        reportSubjectIncludes: ['DoorDash', 'marketing report'],
        reportInboxLabel: 'INBOX',
        diagnosticsDir,
        sqliteDbPath: path.join(tempDir, 'ingestion.sqlite'),
        postgresDatabaseUrl: '',
        fixtureReportDir: path.dirname(validFixture),
    };

    const window = {
        weekStart: '2026-07-13',
        weekEndExclusive: '2026-07-20',
        startLabel: '07/13/2026',
        endLabel: '07/20/2026',
        label: '07/13/2026 - 07/20/2026',
    };

    function messageWithAttachment(messageId: string, filePath: string, subjectStoreName: string): GmailInboxMessage {
        return {
            uid: 1,
            messageId,
            subject: `DoorDash marketing report ${subjectStoreName}`,
            from: ['reports@doordash.com'],
            to: [store!.email],
            receivedAt: new Date().toISOString(),
            text: 'Weekly export attached.',
            attachments: [{
                filename: path.basename(filePath),
                contentType: 'application/octet-stream',
                content: fs.readFileSync(filePath),
            }],
        };
    }

    const first = await ingestWeeklyReportForStore({
        storage,
        config,
        store,
        window,
        messages: [messageWithAttachment('message-valid', validFixture, store.name)],
    });
    assert.equal(first.alreadyProcessed, false);
    assert.ok(first.matchedCampaigns.length > 0);
    assert.ok(first.upsert.created > 0);

    const second = await ingestWeeklyReportForStore({
        storage,
        config,
        store,
        window,
        messages: [messageWithAttachment('message-valid', validFixture, store.name)],
    });
    assert.equal(second.alreadyProcessed, true);

    await assert.rejects(
        ingestWeeklyReportForStore({
            storage,
            config,
            store,
            window,
            messages: [],
            now: new Date('2026-07-27T00:00:00.000Z'),
        }),
        /has not arrived yet/i,
    );

    await assert.rejects(
        ingestWeeklyReportForStore({
            storage,
            config,
            store,
            window,
            messages: [],
            now: new Date('2026-07-28T18:06:00.000Z'),
        }),
        /delivery window expired/i,
    );

    const corruptPath = path.join(tempDir, 'corrupt.zip');
    fs.writeFileSync(corruptPath, 'not a real zip file');
    await assert.rejects(
        ingestWeeklyReportForStore({
            storage,
            config,
            store,
            window,
            messages: [messageWithAttachment('message-corrupt', corruptPath, store.name)],
        }),
        /No usable report artifact was found|unsupported|invalid|zip/i,
    );

    const emptyCsvPath = path.join(tempDir, 'empty.csv');
    fs.writeFileSync(emptyCsvPath, 'Date,Campaign ID,Campaign name,Store ID,Store name\n');
    await assert.rejects(
        ingestWeeklyReportForStore({
            storage,
            config,
            store,
            window,
            messages: [messageWithAttachment('message-empty', emptyCsvPath, store.name)],
        }),
        /contains no campaign rows/i,
    );

    await assert.rejects(
        ingestWeeklyReportForStore({
            storage,
            config,
            store,
            window,
            messages: [{
                uid: 9,
                messageId: 'message-oversized',
                subject: `DoorDash marketing report ${store.name}`,
                from: ['reports@doordash.com'],
                to: [store.email],
                receivedAt: new Date().toISOString(),
                text: 'Weekly export attached.',
                attachments: [{
                    filename: 'oversized.csv',
                    contentType: 'text/csv',
                    content: Buffer.alloc((15 * 1024 * 1024) + 1, 'a'),
                }],
            }],
        }),
        /exceeds the .* safety limit/i,
    );

    const unsafeZipPath = path.join(tempDir, 'unsafe.zip');
    const unsafeZip = new AdmZip();
    for (let index = 0; index < 25; index += 1) {
        unsafeZip.addFile(`file-${index}.csv`, Buffer.from('Date,Campaign ID,Campaign name,Store ID,Store name\n'));
    }
    unsafeZip.writeZip(unsafeZipPath);
    await assert.rejects(
        ingestWeeklyReportForStore({
            storage,
            config,
            store,
            window,
            messages: [messageWithAttachment('message-unsafe-zip', unsafeZipPath, store.name)],
        }),
        /too many files/i,
    );

    await assert.rejects(
        ingestWeeklyReportForStore({
            storage,
            config,
            store: mismatchStore,
            window,
            messages: [messageWithAttachment('message-mismatch', validFixture, mismatchStore.name)],
        }),
        /failed Store ID validation|does not match store/i,
    );

    const originalFetchRecentMessages = GmailInboxClient.prototype.fetchRecentMessages;
    GmailInboxClient.prototype.fetchRecentMessages = async () => {
        throw new ImapAuthenticationError('bad credentials');
    };
    await assert.rejects(
        ingestWeeklyReportForStore({
            storage,
            config,
            store,
            window,
        }),
        error => error instanceof ReportAuthenticationError,
    );

    GmailInboxClient.prototype.fetchRecentMessages = async () => {
        throw new ImapConnectionError('timeout');
    };
    await assert.rejects(
        ingestWeeklyReportForStore({
            storage,
            config,
            store,
            window,
        }),
        error => error instanceof ReportInboxUnavailableError,
    );
    GmailInboxClient.prototype.fetchRecentMessages = originalFetchRecentMessages;

    await storage.close();
    console.log('production-ingestion tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
