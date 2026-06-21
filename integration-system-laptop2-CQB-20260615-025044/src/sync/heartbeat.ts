import { getDb } from '../server/db/client.js';

const INTERVAL_MS = 5 * 60 * 1000;
const APP_VERSION = '1.0.0';

let _startedAt = Date.now();

function getSetting(key: string, fallback: string): string {
    try {
        const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
        return row?.value ?? fallback;
    } catch {
        return fallback;
    }
}

function getMachineId(): string { return getSetting('machine_id', 'laptop-01'); }

function getCeoAppUrl(): string {
    const override = getSetting('ceo_doordash_url', '');
    if (override) return override;
    const base = getSetting('mi_core_url', process.env['MI_CORE_URL'] ?? '');
    if (!base) return '';
    // same host as MI-CORE but port 3000
    return base.replace(/:\d+\/?$/, ':3000');
}

function collectPayload(): Record<string, any> {
    const db = getDb();
    let loopStatus = 'idle', loopLastRunAt = null as string | null, loopLastResult = null as string | null;
    try {
        const loop = db.prepare(`SELECT status, started_at, completed_at, summary FROM loop_runs ORDER BY started_at DESC LIMIT 1`).get() as any;
        if (loop) { loopStatus = loop.status; loopLastRunAt = loop.completed_at ?? loop.started_at; loopLastResult = loop.status; }
    } catch { }

    let approvalQueueSize = 0, pendingExecutions = 0;
    try {
        approvalQueueSize = (db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status='pending'`).get() as any)?.n ?? 0;
        pendingExecutions = (db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status='approved' AND executed_at IS NULL`).get() as any)?.n ?? 0;
    } catch { }

    let doordashConnected = false;
    try { doordashConnected = (db.prepare(`SELECT value FROM settings WHERE key='dd_session_status'`).get() as any)?.value === 'connected'; } catch { }

    let snapshotCountToday = 0;
    try { snapshotCountToday = (db.prepare(`SELECT COUNT(*) AS n FROM campaign_snapshots WHERE DATE(created_at)=DATE('now')`).get() as any)?.n ?? 0; } catch { }

    let executionCountToday = 0, lastExecutionAt = null as string | null, lastExecutionResult = null as string | null;
    try {
        executionCountToday = (db.prepare(`SELECT COUNT(*) AS n FROM execution_logs WHERE DATE(executed_at)=DATE('now')`).get() as any)?.n ?? 0;
        const le = db.prepare(`SELECT executed_at, result, action FROM execution_logs ORDER BY executed_at DESC LIMIT 1`).get() as any;
        if (le) { lastExecutionAt = le.executed_at; lastExecutionResult = `${le.action}: ${le.result}`.slice(0, 100); }
    } catch { }

    const storeStatuses: Record<string, any> = {};
    try {
        const stores = db.prepare(`SELECT id, name FROM stores WHERE active=1`).all() as any[];
        for (const s of stores) {
            const last = db.prepare(`SELECT week_start, roas FROM campaign_snapshots WHERE store_id=? ORDER BY created_at DESC LIMIT 1`).get(s.id) as any;
            storeStatuses[s.id] = { name: s.name, last_snapshot_week: last?.week_start ?? null, last_roas: last?.roas ?? null };
        }
    } catch { }

    return {
        machine_id: getMachineId(),
        hostname: process.env['COMPUTERNAME'] ?? process.env['HOSTNAME'] ?? 'unknown',
        platform: process.platform,
        app_version: APP_VERSION,
        loop_status: loopStatus,
        loop_last_run_at: loopLastRunAt,
        loop_last_result: loopLastResult,
        approval_queue_size: approvalQueueSize,
        pending_executions: pendingExecutions,
        doordash_connected: doordashConnected,
        snapshot_count_today: snapshotCountToday,
        execution_count_today: executionCountToday,
        last_execution_at: lastExecutionAt,
        last_execution_result: lastExecutionResult,
        store_statuses: storeStatuses,
        uptime_seconds: Math.floor((Date.now() - _startedAt) / 1000),
    };
}

async function sendHeartbeat(): Promise<void> {
    const url = getCeoAppUrl();
    if (!url) return;
    try {
        const res = await fetch(`${url}/api/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collectPayload()),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) console.warn(`[heartbeat] rejected: ${res.status}`);
    } catch (e: any) {
        console.warn(`[heartbeat] Could not reach CEO app: ${e.message}`);
    }
}

export function startHeartbeatScheduler(): void {
    _startedAt = Date.now();
    setTimeout(() => {
        sendHeartbeat();
        setInterval(sendHeartbeat, INTERVAL_MS);
    }, 30_000);
    console.log('[heartbeat] Scheduler started -- pushing to CEO app every 5 min');
}