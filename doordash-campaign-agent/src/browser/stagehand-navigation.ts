import type { Page } from 'playwright';

export type AiBrowserProvider = 'stagehand' | 'playwright' | 'disabled';
export type AiBrowserStatus = 'handled' | 'disabled' | 'unavailable' | 'failed';

export interface AiBrowserStepResult {
    ok: boolean;
    provider: AiBrowserProvider;
    status: AiBrowserStatus;
    instruction: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface StagehandRuntimeStatus {
    enabled: boolean;
    model: string;
    env: string;
    selfHealing: boolean;
    lastStatus: AiBrowserStatus | 'idle';
    lastMessage: string;
}

type StagehandInstance = {
    init?: () => Promise<void>;
    act?: (instruction: string, options?: Record<string, unknown>) => Promise<unknown>;
    extract?: (instruction: string, options?: Record<string, unknown>) => Promise<unknown>;
    close?: () => Promise<void>;
};

let stagehand: StagehandInstance | null = null;
let initPromise: Promise<StagehandInstance | null> | null = null;
let lastStatus: StagehandRuntimeStatus = {
    enabled: false,
    model: 'default',
    env: 'LOCAL',
    selfHealing: true,
    lastStatus: 'idle',
    lastMessage: 'Stagehand has not been used in this process.',
};

function envFlag(name: string): boolean {
    const value = process.env[name];
    return value === 'true' || value === '1' || value === 'yes';
}

function timeoutMs(): number {
    const parsed = Number(process.env['DD_STAGEHAND_TIMEOUT_MS'] || 30000);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

export function isStagehandEnabled(): boolean {
    return envFlag('DD_STAGEHAND_ENABLED') || envFlag('STAGEHAND_ENABLED');
}

export function getStagehandRuntimeStatus(): StagehandRuntimeStatus {
    return {
        ...lastStatus,
        enabled: isStagehandEnabled(),
        model: process.env['DD_STAGEHAND_MODEL'] || process.env['STAGEHAND_MODEL'] || 'default',
        env: process.env['DD_STAGEHAND_ENV'] || 'LOCAL',
        selfHealing: process.env['DD_STAGEHAND_SELF_HEAL'] !== 'false',
    };
}

async function loadStagehand(): Promise<StagehandInstance | null> {
    if (!isStagehandEnabled()) {
        lastStatus = {
            ...getStagehandRuntimeStatus(),
            lastStatus: 'disabled',
            lastMessage: 'Stagehand is disabled. Set DD_STAGEHAND_ENABLED=true to enable AI-assisted browser navigation.',
        };
        return null;
    }

    if (stagehand) return stagehand;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            const mod = await import('@browserbasehq/stagehand');
            const StagehandCtor = (mod as any).Stagehand || (mod as any).default?.Stagehand || (mod as any).default;
            if (!StagehandCtor) {
                lastStatus = {
                    ...getStagehandRuntimeStatus(),
                    lastStatus: 'unavailable',
                    lastMessage: 'The @browserbasehq/stagehand package did not expose a Stagehand constructor.',
                };
                return null;
            }

            const options: Record<string, unknown> = {
                env: process.env['DD_STAGEHAND_ENV'] || 'LOCAL',
                selfHeal: process.env['DD_STAGEHAND_SELF_HEAL'] !== 'false',
                disablePino: true,
                cacheDir: process.env['DD_STAGEHAND_CACHE_DIR'] || './data/stagehand-cache',
            };
            const modelName = process.env['DD_STAGEHAND_MODEL'] || process.env['STAGEHAND_MODEL'];
            if (modelName) {
                options['model'] = { modelName };
            }

            const instance = new StagehandCtor(options) as StagehandInstance;
            if (instance.init) {
                await instance.init();
            }

            stagehand = instance;
            lastStatus = {
                ...getStagehandRuntimeStatus(),
                lastStatus: 'handled',
                lastMessage: 'Stagehand initialized for AI-assisted DoorDash navigation.',
            };
            return instance;
        } catch (error: any) {
            lastStatus = {
                ...getStagehandRuntimeStatus(),
                lastStatus: 'unavailable',
                lastMessage: `Stagehand unavailable: ${error.message}`,
            };
            return null;
        }
    })();

    return initPromise;
}

export async function stagehandAct(page: Page, instruction: string, details: Record<string, unknown> = {}): Promise<AiBrowserStepResult> {
    if (!isStagehandEnabled()) {
        return {
            ok: false,
            provider: 'disabled',
            status: 'disabled',
            instruction,
            message: 'Stagehand disabled; deterministic Playwright path remains active.',
            details,
        };
    }

    const instance = await loadStagehand();
    if (!instance?.act) {
        return {
            ok: false,
            provider: 'stagehand',
            status: 'unavailable',
            instruction,
            message: lastStatus.lastMessage,
            details,
        };
    }

    try {
        await instance.act(instruction, {
            page,
            timeout: timeoutMs(),
        });
        lastStatus = {
            ...getStagehandRuntimeStatus(),
            lastStatus: 'handled',
            lastMessage: `Stagehand completed: ${instruction}`,
        };
        return {
            ok: true,
            provider: 'stagehand',
            status: 'handled',
            instruction,
            message: 'Stagehand completed the AI-assisted browser step.',
            details,
        };
    } catch (error: any) {
        lastStatus = {
            ...getStagehandRuntimeStatus(),
            lastStatus: 'failed',
            lastMessage: `Stagehand failed: ${error.message}`,
        };
        return {
            ok: false,
            provider: 'stagehand',
            status: 'failed',
            instruction,
            message: `Stagehand failed: ${error.message}`,
            details,
        };
    }
}

export async function closeStagehand(): Promise<void> {
    const instance = stagehand;
    stagehand = null;
    initPromise = null;
    if (instance?.close) {
        await instance.close().catch(() => undefined);
    }
}
