import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import {
    assertImapEnvConfigured,
    GmailInboxClient,
} from '../src/integrations/email/gmail-inbox-client.js';
import {
    assertProductionWorkflowConfig,
    readProductionWorkflowConfig,
} from '../src/production/config.js';
import { prepareWeeklyReportForStore } from '../src/production/reporting/report-ingestion-service.js';
import { sanitizeErrorMessage, sanitizeSecrets } from '../src/production/security/error-sanitizer.js';
import { createProductionStorage } from '../src/production/storage/storage-factory.js';
import { configuredProductionStores, resolveConfiguredProductionStore, validateProductionStoreCatalog } from '../src/production/store-catalog.js';
import { createWeeklyReportingWindow, getCompletedWeeklyReportingWindow } from '../src/automation/weekly-reporting-window.js';

type StepStatus = 'success' | 'failed';

interface StepResult {
    step: string;
    status: StepStatus;
    detail: string;
}

interface PreflightResult {
    success: boolean;
    trigger: string;
    weekStart: string;
    weekEndExclusive: string;
    checkedStores: string[];
    steps: StepResult[];
    summary: string;
}

function parseArgs(argv: string[]): { trigger: string; storeIds: string[]; weekStart?: string; weekEndExclusive?: string } {
    const result = {
        trigger: 'manual-preflight',
        storeIds: [] as string[],
        weekStart: undefined as string | undefined,
        weekEndExclusive: undefined as string | undefined,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        const next = argv[index + 1];
        if (token === '--trigger' && next) {
            result.trigger = next;
            index += 1;
        } else if (token === '--stores' && next) {
            result.storeIds = next.split(',').map(item => item.trim()).filter(Boolean);
            index += 1;
        } else if (token === '--week-start' && next) {
            result.weekStart = next;
            index += 1;
        } else if (token === '--week-end-exclusive' && next) {
            result.weekEndExclusive = next;
            index += 1;
        }
    }
    return result;
}

function requiredEnv(name: string): string {
    const value = (process.env[name] || '').trim();
    if (!value) {
        throw new Error(`${name} is required for production preflight.`);
    }
    return value;
}

function assertRequiredIsolatedConfig(): void {
    for (const key of [
        'OPENAI_API_KEY',
        'OPENAI_MODEL',
        'DATABASE_URL',
        'IMAP_USER',
        'IMAP_PASS',
        'DD_REPORT_ALLOWED_SENDERS',
        'IMAP_HOST',
        'IMAP_PORT',
        'IMAP_SECURE',
    ]) {
        requiredEnv(key);
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`OpenAI preflight timed out after ${timeoutMs} ms.`)), timeoutMs);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

async function validateOpenAiConnectivity(model: string, apiKey: string): Promise<void> {
    const client = new OpenAI({ apiKey });
    const response = await withTimeout(client.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: 'Reply with OK.' },
            { role: 'user', content: 'healthcheck' },
        ],
        max_tokens: 5,
    }), 20_000);
    const content = response.choices?.[0]?.message?.content || '';
    if (!content.trim()) {
        throw new Error('OpenAI preflight returned an empty response.');
    }
}

function shortHash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function printResult(result: PreflightResult): void {
    console.log(JSON.stringify(sanitizeSecrets(result), null, 2));
}

(async () => {
    const args = parseArgs(process.argv.slice(2));
    const config = readProductionWorkflowConfig();
    const window = args.weekStart
        ? createWeeklyReportingWindow(config.schedulerTimeZone, args.weekStart, args.weekEndExclusive)
        : getCompletedWeeklyReportingWindow(config.schedulerTimeZone);
    const requestedStoreIds = args.storeIds.length > 0 ? args.storeIds : ['raw-sushi-bar'];
    const steps: StepResult[] = [];

    const fail = (step: string, error: unknown): never => {
        const detail = sanitizeErrorMessage(error);
        steps.push({ step, status: 'failed', detail });
        const result: PreflightResult = {
            success: false,
            trigger: args.trigger,
            weekStart: window.weekStart,
            weekEndExclusive: window.weekEndExclusive,
            checkedStores: requestedStoreIds,
            steps,
            summary: `Production preflight failed during ${step}.`,
        };
        printResult(result);
        process.exit(1);
    };

    try {
        assertRequiredIsolatedConfig();
        assertImapEnvConfigured();
        assertProductionWorkflowConfig(config);
        if (config.executionEnv !== 'production') {
            throw new Error('Production preflight requires DD_EXECUTION_ENV=production.');
        }
        if (config.reportSource !== 'imap') {
            throw new Error('Production preflight requires DD_REPORT_SOURCE=imap.');
        }
        if (config.storageBackend !== 'postgres') {
            throw new Error('Production preflight requires DD_STORAGE_BACKEND=postgres.');
        }
        steps.push({ step: 'config', status: 'success', detail: 'Required isolated variables and secrets are present.' });
    } catch (error) {
        fail('config', error);
    }

    let targetStores = configuredProductionStores().filter(store => requestedStoreIds.includes(store.id));
    try {
        validateProductionStoreCatalog();
        const rawSushiBar = resolveConfiguredProductionStore('raw-sushi-bar');
        if (!rawSushiBar || rawSushiBar.doorDashAccountId !== '892006') {
            throw new Error('raw-sushi-bar must map to DoorDash Store ID 892006.');
        }
        if (targetStores.length !== requestedStoreIds.length) {
            const missing = requestedStoreIds.filter(id => !targetStores.some(store => store.id === id));
            throw new Error(`Unknown production store ids: ${missing.join(', ')}`);
        }
        steps.push({ step: 'store_catalog', status: 'success', detail: `Validated ${targetStores.length} production store mapping(s), including raw-sushi-bar -> 892006.` });
    } catch (error) {
        fail('store_catalog', error);
    }

    try {
        const storage = createProductionStorage(config);
        await storage.initialize();
        await storage.close();
        steps.push({ step: 'postgres', status: 'success', detail: 'Postgres connection, migrations, and store bootstrap succeeded.' });
    } catch (error) {
        fail('postgres', error);
    }

    let messages;
    try {
        const inbox = new GmailInboxClient();
        messages = await inbox.fetchRecentMessages(config.reportLookbackHours, config.reportInboxLabel);
        steps.push({ step: 'imap_auth', status: 'success', detail: 'IMAP authentication and mailbox access succeeded.' });
    } catch (error) {
        fail('imap_auth', error);
    }

    try {
        for (const store of targetStores) {
            const prepared = await prepareWeeklyReportForStore({
                config,
                store,
                window,
                messages,
            });
            steps.push({
                step: `report_${store.id}`,
                status: 'success',
                detail: `Located a valid report artifact for ${store.id} with ${prepared.matchedCampaigns.length} matched campaign(s) and message fingerprint ${shortHash(prepared.messageId)}.`,
            });
        }
    } catch (error) {
        fail('report_lookup', error);
    }

    try {
        await validateOpenAiConnectivity(config.openAiModel, config.openAiApiKey);
        steps.push({ step: 'openai', status: 'success', detail: 'OpenAI connectivity succeeded with a minimal safe request.' });
    } catch (error) {
        fail('openai', error);
    }

    const result: PreflightResult = {
        success: true,
        trigger: args.trigger,
        weekStart: window.weekStart,
        weekEndExclusive: window.weekEndExclusive,
        checkedStores: targetStores.map(store => store.id),
        steps,
        summary: 'Production preflight completed successfully.',
    };
    printResult(result);
})().catch((error) => {
    console.error(sanitizeErrorMessage(error));
    process.exit(1);
});
