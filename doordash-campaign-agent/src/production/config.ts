import path from 'path';
import type { AnalysisProviderName, ReportSourceName, RulesEngineConfig, StorageBackendName } from './types.js';

export interface ProductionWorkflowConfig {
    executionEnv: 'production' | 'development' | 'test';
    analysisProvider: AnalysisProviderName;
    reportSource: ReportSourceName;
    storageBackend: StorageBackendName;
    openAiApiKey: string;
    openAiModel: string;
    rules: RulesEngineConfig;
    schedulerTimeZone: string;
    reportLookbackHours: number;
    reportRetryAttempts: number;
    reportRetryDelayMs: number;
    reportDeliveryGraceHours: number;
    reportAllowedSenders: string[];
    reportSubjectIncludes: string[];
    reportInboxLabel: string;
    diagnosticsDir: string;
    sqliteDbPath: string;
    postgresDatabaseUrl: string;
    fixtureReportDir: string;
}

function normalizeList(value: string): string[] {
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function parseInteger(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatValue(value: string | undefined, fallback: number): number {
    const parsed = Number.parseFloat(String(value || ''));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAnalysisProvider(value: string | undefined): AnalysisProviderName {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'openai' || normalized === 'hybrid') {
        return normalized;
    }
    return 'rules';
}

export function readProductionWorkflowConfig(): ProductionWorkflowConfig {
    const executionEnv = (process.env['DD_EXECUTION_ENV'] || process.env['NODE_ENV'] || 'development').toLowerCase();
    const schedulerTimeZone = process.env['DD_SCHEDULER_TIMEZONE'] || 'America/Los_Angeles';
    const analysisProvider = normalizeAnalysisProvider(process.env['ANALYSIS_PROVIDER'] || process.env['DD_ANALYSIS_PROVIDER'] || 'rules');
    const reportSource = (process.env['DD_REPORT_SOURCE'] || 'imap').toLowerCase() as ReportSourceName;
    const storageBackend = (process.env['DD_STORAGE_BACKEND'] || 'sqlite').toLowerCase() as StorageBackendName;

    return {
        executionEnv: executionEnv === 'production' ? 'production' : executionEnv === 'test' ? 'test' : 'development',
        analysisProvider,
        reportSource,
        storageBackend,
        openAiApiKey: process.env['OPENAI_API_KEY'] || '',
        openAiModel: process.env['OPENAI_MODEL'] || 'gpt-5-mini',
        rules: {
            ruleVersion: process.env['DD_RULE_VERSION'] || 'rules-v1',
            minAcceptableRoas: parseFloatValue(process.env['DD_RULE_MIN_ROAS'], 3),
            maxAcceptableCpa: parseFloatValue(process.env['DD_RULE_MAX_CPA'], 25),
            minimumSpendForJudgement: parseFloatValue(process.env['DD_RULE_MIN_SPEND'], 25),
            minimumImpressionsForConfidence: parseInteger(process.env['DD_RULE_MIN_IMPRESSIONS'], 1000),
            minimumClicksForConfidence: parseInteger(process.env['DD_RULE_MIN_CLICKS'], 25),
            deteriorationThresholdPct: parseFloatValue(process.env['DD_RULE_DETERIORATION_PCT'], 0.2),
            budgetIncreaseCeilingPct: parseFloatValue(process.env['DD_RULE_BUDGET_INCREASE_CEILING_PCT'], 0.2),
            storeCurrency: process.env['DD_STORE_CURRENCY'] || 'USD',
            storeTimeZone: process.env['DD_STORE_TIMEZONE'] || schedulerTimeZone,
        },
        schedulerTimeZone,
        reportLookbackHours: parseInteger(process.env['DD_REPORT_LOOKBACK_HOURS'], 240),
        reportRetryAttempts: parseInteger(process.env['DD_REPORT_RETRY_ATTEMPTS'], 3),
        reportRetryDelayMs: parseInteger(process.env['DD_REPORT_RETRY_DELAY_MS'], 2000),
        reportDeliveryGraceHours: parseInteger(process.env['DD_REPORT_DELIVERY_GRACE_HOURS'], 36),
        reportAllowedSenders: normalizeList(process.env['DD_REPORT_ALLOWED_SENDERS'] || ''),
        reportSubjectIncludes: normalizeList(process.env['DD_REPORT_SUBJECT_INCLUDES'] || 'Doordash,DoorDash,marketing report'),
        reportInboxLabel: process.env['DD_REPORT_INBOX_LABEL'] || 'INBOX',
        diagnosticsDir: path.resolve(process.env['DD_DIAGNOSTICS_DIR'] || path.resolve(process.cwd(), 'artifacts', 'weekly-production')),
        sqliteDbPath: process.env['DB_PATH'] || path.resolve(process.cwd(), 'data', 'doordash-campaigns.db'),
        postgresDatabaseUrl: process.env['DATABASE_URL'] || '',
        fixtureReportDir: path.resolve(process.env['DD_FIXTURE_REPORT_DIR'] || path.resolve(process.cwd(), 'data', 'fixtures', 'reports')),
    };
}

export function assertProductionWorkflowConfig(config: ProductionWorkflowConfig): void {
    if (!['rules', 'openai', 'hybrid'].includes(config.analysisProvider)) {
        throw new Error(`Unsupported DD_ANALYSIS_PROVIDER "${config.analysisProvider}".`);
    }
    if (!['imap', 'fixture'].includes(config.reportSource)) {
        throw new Error(`Unsupported DD_REPORT_SOURCE "${config.reportSource}".`);
    }
    if (!['sqlite', 'postgres'].includes(config.storageBackend)) {
        throw new Error(`Unsupported DD_STORAGE_BACKEND "${config.storageBackend}".`);
    }

    if (config.executionEnv === 'production') {
        if (config.reportSource === 'fixture') {
            throw new Error('Production execution rejects fixture report ingestion. Set DD_REPORT_SOURCE=imap.');
        }
    }

    if (config.analysisProvider === 'openai') {
        if (!config.openAiApiKey) {
            throw new Error('OPENAI_API_KEY is required when ANALYSIS_PROVIDER=openai.');
        }
        if (!config.openAiModel) {
            throw new Error('OPENAI_MODEL is required when DD_ANALYSIS_PROVIDER=openai.');
        }
    }

    if (config.rules.minAcceptableRoas <= 0) {
        throw new Error('DD_RULE_MIN_ROAS must be greater than zero.');
    }
    if (config.rules.maxAcceptableCpa <= 0) {
        throw new Error('DD_RULE_MAX_CPA must be greater than zero.');
    }
    if (config.rules.minimumSpendForJudgement < 0) {
        throw new Error('DD_RULE_MIN_SPEND must be zero or greater.');
    }
    if (config.rules.minimumImpressionsForConfidence < 0 || config.rules.minimumClicksForConfidence < 0) {
        throw new Error('DD_RULE_MIN_IMPRESSIONS and DD_RULE_MIN_CLICKS must be zero or greater.');
    }
    if (config.rules.deteriorationThresholdPct < 0 || config.rules.deteriorationThresholdPct > 1) {
        throw new Error('DD_RULE_DETERIORATION_PCT must be between 0 and 1.');
    }
    if (config.rules.budgetIncreaseCeilingPct <= 0 || config.rules.budgetIncreaseCeilingPct > 1) {
        throw new Error('DD_RULE_BUDGET_INCREASE_CEILING_PCT must be greater than 0 and at most 1.');
    }

    if (config.reportSource === 'imap' && config.reportAllowedSenders.length === 0) {
        throw new Error('DD_REPORT_ALLOWED_SENDERS is required for IMAP report ingestion.');
    }

    if (config.storageBackend === 'postgres' && !config.postgresDatabaseUrl) {
        throw new Error('DATABASE_URL is required when DD_STORAGE_BACKEND=postgres.');
    }
}
