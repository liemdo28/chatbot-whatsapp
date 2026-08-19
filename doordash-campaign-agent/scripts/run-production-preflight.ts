import crypto from 'crypto';
import OpenAI from 'openai';
import {
    assertImapEnvConfigured,
} from '../src/integrations/email/gmail-inbox-client.js';
import {
    assertProductionWorkflowConfig,
    readProductionWorkflowConfig,
} from '../src/production/config.js';
import { discoverWeeklyReportsForStores } from '../src/production/reporting/report-ingestion-service.js';
import { sanitizeErrorMessage, sanitizeSecrets } from '../src/production/security/error-sanitizer.js';
import { createProductionStorage } from '../src/production/storage/storage-factory.js';
import {
    assertStoresReadyForProductionRun,
    enabledProductionStores,
    sanitizeProductionStoreCatalogRows,
    validateProductionStoreCatalog,
} from '../src/production/store-catalog.js';
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

function assertRequiredIsolatedConfig(provider: string): void {
    const required = [
        'DATABASE_URL',
        'IMAP_USER',
        'IMAP_PASS',
        'DD_REPORT_ALLOWED_SENDERS',
        'IMAP_HOST',
        'IMAP_PORT',
        'IMAP_SECURE',
    ];
    if (provider === 'openai') {
        required.push('OPENAI_API_KEY', 'OPENAI_MODEL');
    }
    for (const key of required) {
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

function uniqueWindows(storeWindows: Array<{ window: { weekStart: string; weekEndExclusive: string } }>): Array<{ weekStart: string; weekEndExclusive: string }> {
    const seen = new Set<string>();
    const windows: Array<{ weekStart: string; weekEndExclusive: string }> = [];
    for (const item of storeWindows) {
        const key = `${item.window.weekStart}|${item.window.weekEndExclusive}`;
        if (!seen.has(key)) {
            seen.add(key);
            windows.push({ weekStart: item.window.weekStart, weekEndExclusive: item.window.weekEndExclusive });
        }
    }
    return windows;
}

(async () => {
    const args = parseArgs(process.argv.slice(2));
    const config = readProductionWorkflowConfig();
    const requestedStoreIds = args.storeIds;
    const steps: StepResult[] = [];
    let resolvedWeekStart = args.weekStart || '';
    let resolvedWeekEndExclusive = args.weekEndExclusive || '';

    const fail = (step: string, error: unknown): never => {
        const detail = sanitizeErrorMessage(error);
        steps.push({ step, status: 'failed', detail });
        const result: PreflightResult = {
            success: false,
            trigger: args.trigger,
            weekStart: resolvedWeekStart,
            weekEndExclusive: resolvedWeekEndExclusive,
            checkedStores: requestedStoreIds,
            steps,
            summary: `Production preflight failed during ${step}.`,
        };
        printResult(result);
        process.exit(1);
    };

    try {
        assertRequiredIsolatedConfig(config.analysisProvider);
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
        steps.push({ step: 'config', status: 'success', detail: `Required isolated variables and secrets are present for provider ${config.analysisProvider}.` });
    } catch (error) {
        fail('config', error);
    }

    let targetStores = enabledProductionStores(requestedStoreIds);
    try {
        validateProductionStoreCatalog();
        if (requestedStoreIds.length > 0 && targetStores.length !== requestedStoreIds.length) {
            const missing = requestedStoreIds.filter(id => !targetStores.some(store => store.storeSlug === id));
            throw new Error(`Unknown production store ids: ${missing.join(', ')}`);
        }
        console.table(sanitizeProductionStoreCatalogRows(targetStores).map(row => ({
            storeSlug: row.storeSlug,
            displayName: row.displayName,
            doorDashStoreId: row.doorDashStoreId,
            timezone: row.timezone,
            currency: row.currency,
            enabled: row.enabled,
            reportStatus: row.mappingStatus,
        })));
        assertStoresReadyForProductionRun(targetStores);
        steps.push({ step: 'store_catalog', status: 'success', detail: `Validated ${targetStores.length} enabled production store mapping(s).` });
    } catch (error) {
        fail('store_catalog', error);
    }

    const storeWindows = targetStores.map(store => ({
        store,
        window: args.weekStart
            ? createWeeklyReportingWindow(store.timezone, args.weekStart, args.weekEndExclusive)
            : getCompletedWeeklyReportingWindow(store.timezone),
    }));
    const windows = uniqueWindows(storeWindows);
    resolvedWeekStart = windows.map(item => item.weekStart).join(',');
    resolvedWeekEndExclusive = windows.map(item => item.weekEndExclusive).join(',');

    try {
        steps.push({
            step: 'store_locale',
            status: 'success',
            detail: `Validated per-store reporting metadata for ${targetStores.length} enabled store(s).`,
        });
    } catch (error) {
        fail('store_locale', error);
    }

    try {
        const storage = createProductionStorage(config);
        await storage.initialize();
        await storage.close();
        steps.push({ step: 'postgres', status: 'success', detail: 'Postgres connection, migrations, and store bootstrap succeeded.' });
    } catch (error) {
        fail('postgres', error);
    }

    let discovery;
    try {
        discovery = await discoverWeeklyReportsForStores({
            config,
            storeWindows,
        });
        const imapFailure = discovery.stores.find((store: { status: string }) => store.status === 'imap_failure');
        if (imapFailure) {
            throw imapFailure.error || new Error(imapFailure.detail);
        }
        steps.push({ step: 'imap_auth', status: 'success', detail: 'IMAP authentication and mailbox access succeeded.' });
    } catch (error) {
        fail('imap_auth', error);
    }

    try {
        for (const storeResult of discovery.stores) {
            if (storeResult.status !== 'ready' || !storeResult.prepared) {
                throw storeResult.error || new Error(storeResult.detail);
            }
            steps.push({
                step: `report_${storeResult.storeId}`,
                status: 'success',
                detail: `Located a valid report artifact for ${storeResult.storeId} with ${storeResult.prepared.matchedCampaigns.length} matched campaign(s) and message fingerprint ${shortHash(storeResult.prepared.messageId)}.`,
            });
        }
        steps.push({
            step: 'report_diagnostics',
            status: 'success',
            detail: `Mailbox scan classified ${discovery.reportFoundCount} ready report(s), ${discovery.missingReportCount} missing report(s), and rejected ${discovery.rejectedCandidateCount} candidate(s).`,
        });
    } catch (error) {
        fail('report_lookup', error);
    }

    if (config.analysisProvider === 'rules') {
        steps.push({
            step: 'rules_config',
            status: 'success',
            detail: `Rules mode is active with ${config.rules.ruleVersion} and does not require OpenAI connectivity.`,
        });
    } else if (config.analysisProvider === 'hybrid' && !config.openAiApiKey) {
        steps.push({
            step: 'hybrid_openai',
            status: 'success',
            detail: `Hybrid mode is active with ${config.rules.ruleVersion}; OpenAI enrichment is optional and will be skipped until OPENAI_API_KEY is configured.`,
        });
    } else {
        try {
            await validateOpenAiConnectivity(config.openAiModel, config.openAiApiKey);
            steps.push({ step: 'openai', status: 'success', detail: 'OpenAI connectivity succeeded with a minimal safe request.' });
        } catch (error) {
            fail('openai', error);
        }
    }

    const result: PreflightResult = {
        success: true,
        trigger: args.trigger,
        weekStart: resolvedWeekStart,
        weekEndExclusive: resolvedWeekEndExclusive,
        checkedStores: targetStores.map(store => store.storeSlug),
        steps,
        summary: 'Production preflight completed successfully.',
    };
    printResult(result);
})().catch((error) => {
    console.error(sanitizeErrorMessage(error));
    process.exit(1);
});
