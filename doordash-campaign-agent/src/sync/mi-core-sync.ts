/**
 * MI-CORE Sync
 * Pulls playbooks, policies, guardrails, and profit model rules
 * from MI-CORE (CEO PC) via the consolidated endpoint every 5 minutes.
 *
 * MI-CORE endpoints:
 *   POST /api/doordash-agent/machines/checkin  (machine registration)
 *   GET  /api/doordash-agent/package/latest    (pull latest package)
 * Response: { version, playbooks, policies, guardrails, profit_rules }
 */
import { getDb } from '../server/db/init.js';
import { v4 as uuidv4 } from 'uuid';

const MI_CORE_URL = process.env['MI_CORE_URL'] || 'http://localhost:4001';
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _syncTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Check-in this machine with MI-CORE before pulling packages
 */
async function checkInMachine(): Promise<void> {
    try {
        const res = await fetch(`${MI_CORE_URL}/api/doordash-agent/machines/checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                machine_id: 'laptop-01',
                hostname: process.env['COMPUTERNAME'] ?? process.env['HOSTNAME'] ?? 'unknown',
                platform: process.platform,
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
            console.log(`[MiCoreSync] Machine check-in OK (${res.status})`);
        } else {
            console.warn(`[MiCoreSync] Machine check-in returned HTTP ${res.status}`);
        }
    } catch (e: any) {
        console.warn(`[MiCoreSync] Machine check-in failed: ${e.message}`);
    }
}

export interface MiCoreSyncState {
    miVersion: string | null;
    policyVersion: string | null;
    playbookVersion: string | null;
    lastSync: string | null;
    syncStatus: string;
    connected: boolean;
}

/**
 * Get current MI-CORE sync state
 */
export function getMiCoreSyncState(): MiCoreSyncState {
    const db = getDb();
    const row = db.prepare('SELECT * FROM mi_core_sync ORDER BY created_at DESC LIMIT 1').get() as any;

    return {
        miVersion: row?.mi_version || null,
        policyVersion: row?.policy_version || null,
        playbookVersion: row?.playbook_version || null,
        lastSync: row?.synced_at || null,
        syncStatus: row?.sync_status || 'not_started',
        connected: !!row && row.sync_status === 'success',
    };
}

/**
 * Sync with MI-CORE via consolidated endpoint
 */
export async function syncWithMiCore(): Promise<{ success: boolean; message: string }> {
    const db = getDb();

    try {
        // Check-in this machine first
        await checkInMachine();

        // Pull latest package from MI-CORE
        const response = await fetch(`${MI_CORE_URL}/api/doordash-agent/package/latest`, {
            signal: AbortSignal.timeout(15000),
        }).catch(() => null);

        if (!response?.ok) {
            const status = response?.status ?? 'no_response';
            console.warn(`[MiCoreSync] MI-CORE unreachable (HTTP ${status}). Skipping sync.`);

            db.prepare(`
                INSERT INTO mi_core_sync (id, sync_type, sync_status, synced_at)
                VALUES (?, ?, 'failed', datetime('now'))
            `).run(uuidv4(), 'full');

            return { success: false, message: `MI-CORE unreachable (HTTP ${status})` };
        }

        const data = await response.json() as {
            version?: string;
            playbooks?: any;
            policies?: any;
            guardrails?: any;
            profit_rules?: any;
        };

        // Parse versions
        const miVersion = data.version || 'unknown';
        const playbookVersion = data.playbooks?.version || data.version || 'unknown';
        const policyVersion = data.policies?.version || data.version || 'unknown';

        // Store each package separately for granular access
        if (data.playbooks) {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
                .run('mi_playbooks', JSON.stringify(data.playbooks));
        }
        if (data.policies) {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
                .run('mi_policies', JSON.stringify(data.policies));
        }
        if (data.guardrails) {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
                .run('mi_guardrails', JSON.stringify(data.guardrails));
        }
        if (data.profit_rules) {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
                .run('mi_profit_rules', JSON.stringify(data.profit_rules));
        }

        // Record sync
        db.prepare(`
            INSERT INTO mi_core_sync (id, sync_type, payload, mi_version, policy_version, playbook_version, sync_status, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, 'success', datetime('now'))
        `).run(
            uuidv4(),
            'full',
            JSON.stringify({
                version: miVersion,
                hasPlaybooks: !!data.playbooks,
                hasPolicies: !!data.policies,
                hasGuardrails: !!data.guardrails,
                hasProfitRules: !!data.profit_rules,
            }),
            miVersion,
            policyVersion,
            playbookVersion,
        );

        console.log(`[MiCoreSync] Synced successfully. Version: ${miVersion}, Playbooks: ${!!data.playbooks}, Policies: ${!!data.policies}, Guardrails: ${!!data.guardrails}, ProfitRules: ${!!data.profit_rules}`);
        return { success: true, message: `Synced with MI-CORE v${miVersion}` };
    } catch (error: any) {
        console.error(`[MiCoreSync] Sync failed:`, error);

        db.prepare(`
            INSERT INTO mi_core_sync (id, sync_type, sync_status, synced_at)
            VALUES (?, ?, 'failed', datetime('now'))
        `).run(uuidv4(), 'full');

        return { success: false, message: `Sync failed: ${error.message}` };
    }
}

/**
 * Start the MI-CORE sync scheduler (every 5 minutes)
 */
export function startMiCoreSync(): void {
    if (_syncTimer) {
        console.log('[MiCoreSync] Already running.');
        return;
    }

    // Do initial sync after 30 seconds
    setTimeout(() => {
        syncWithMiCore().catch(() => { });
    }, 30000);

    _syncTimer = setInterval(() => {
        syncWithMiCore().catch(() => { });
    }, SYNC_INTERVAL_MS);

    console.log('[MiCoreSync] Scheduler started. Syncing every 5 minutes.');
}

/**
 * Stop the MI-CORE sync scheduler
 */
export function stopMiCoreSync(): void {
    if (_syncTimer) {
        clearInterval(_syncTimer);
        _syncTimer = null;
    }
}

/**
 * Get MI-CORE settings (policies, guardrails, etc.)
 */
export function getMiCoreSetting(key: string): any {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`mi_${key}`) as any;
    if (!row) return null;
    try {
        return JSON.parse(row.value);
    } catch {
        return row.value;
    }
}