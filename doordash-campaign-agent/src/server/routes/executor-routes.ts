/**
 * Executor Routes
 * API endpoints for campaign operations: read, analyze, execute, approve.
 */
import { Router } from 'express';
import { readCampaigns, readAllStoreCampaigns, getStoredCampaigns } from '../../executor/campaign-reader.js';
import { loginToDoorDash, testDoorDashConnection, getLoginStatus, reuseExistingSession } from '../../executor/doordash-login.js';
import { logoutDoorDash, forceClearSession } from '../../executor/doordash-logout.js';
import { analyzeStoreCampaigns, getPendingRecommendations, updateRecommendationStatus } from '../../intelligence/campaign-analyzer.js';
import { executeApprovedChange, executeRollback } from '../../executor/campaign-executor.js';
import { getAllSessionStatuses, getSessionStatus, clearPersistedSession, getPage } from '../../executor/account-session-manager.js';
import { triggerManualLoop, getLastLoopRun } from '../../automation/weekly-loop.js';
import { getMiCoreSyncState, syncWithMiCore } from '../../sync/mi-core-sync.js';
import { runCampaignAudit } from '../../audit/campaign-audit.js';
import { getStagehandRuntimeStatus } from '../../browser/stagehand-navigation.js';
import { validateCampaignPage } from '../../qa/browser-use-qa.js';
import { getDb } from '../db/init.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ── Session Status ──────────────────────────────────────
router.get('/api/sessions', (_req, res) => {
    try {
        const statuses = getAllSessionStatuses();
        res.json({ ok: true, sessions: statuses });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.get('/api/sessions/:storeId', (req, res) => {
    try {
        const status = getSessionStatus(req.params.storeId);
        if (!status) return res.status(404).json({ ok: false, error: 'Store not found' });
        res.json({ ok: true, session: status });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ── Login / Logout ──────────────────────────────────────
router.post('/api/login/:storeId', async (req, res) => {
    try {
        const result = await loginToDoorDash(req.params.storeId);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

router.post('/api/logout/:storeId', async (req, res) => {
    try {
        const clearLocal = req.body?.clearLocalSession !== false;
        const result = await logoutDoorDash(req.params.storeId, clearLocal);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

router.post('/api/test-connection/:storeId', async (req, res) => {
    try {
        const result = await testDoorDashConnection(req.params.storeId);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

router.post('/api/reuse-session/:storeId', async (req, res) => {
    try {
        const reused = await reuseExistingSession(req.params.storeId);
        res.json({ ok: reused, message: reused ? 'Session reused' : 'No reusable session found' });
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

router.delete('/api/session/:storeId', (req, res) => {
    try {
        forceClearSession(req.params.storeId);
        res.json({ ok: true, message: 'Session cleared' });
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

// ── Login Status ────────────────────────────────────────
router.get('/api/login-status', (_req, res) => {
    try {
        const db = getDb();
        const stores = db.prepare('SELECT id FROM stores WHERE active = 1').all() as any[];
        const statuses = stores.map(s => getLoginStatus(s.id));
        res.json({ ok: true, statuses });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.get('/api/login-status/:storeId', (req, res) => {
    try {
        const status = getLoginStatus(req.params.storeId);
        res.json({ ok: true, status });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ── Campaigns ───────────────────────────────────────────
router.get('/api/campaigns/:storeId', (req, res) => {
    try {
        const campaigns = getStoredCampaigns(req.params.storeId);
        res.json({ ok: true, campaigns });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.post('/api/campaigns/read/:storeId', async (req, res) => {
    try {
        const result = await readCampaigns(req.params.storeId);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

router.post('/api/campaigns/read-all', async (_req, res) => {
    try {
        const results = await readAllStoreCampaigns();
        res.json({ ok: true, results });
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

router.post('/api/campaigns/qa/:storeId', async (req, res) => {
    try {
        const page = await getPage(req.params.storeId);
        const qa = await validateCampaignPage(page, req.params.storeId);
        res.json({ ok: true, qa });
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

// ── Analysis ────────────────────────────────────────────
router.post('/api/analyze/:storeId', (req, res) => {
    try {
        const { analyses, recommendations } = analyzeStoreCampaigns(req.params.storeId);
        res.json({ ok: true, analyses, recommendations });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.get('/api/recommendations', (_req, res) => {
    try {
        const recommendations = getPendingRecommendations();
        res.json({ ok: true, recommendations });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.put('/api/recommendations/:id', (req, res) => {
    try {
        const { status } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ ok: false, error: 'Invalid status' });
        }
        const updated = updateRecommendationStatus(req.params.id, status);
        if (!updated) return res.status(404).json({ ok: false, error: 'Recommendation not found' });
        res.json({ ok: true, message: `Recommendation ${status}` });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ── Approvals ───────────────────────────────────────────
router.get('/api/approvals', (_req, res) => {
    try {
        const db = getDb();
        const approvals = db.prepare(`
            SELECT a.*, s.name as store_name 
            FROM approvals a 
            JOIN stores s ON a.store_id = s.id 
            ORDER BY a.created_at DESC
        `).all();
        res.json({ ok: true, approvals });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.get('/api/approvals/pending', (_req, res) => {
    try {
        const db = getDb();
        const approvals = db.prepare(`
            SELECT a.*, s.name as store_name 
            FROM approvals a 
            JOIN stores s ON a.store_id = s.id 
            WHERE a.status = 'pending'
            ORDER BY a.created_at DESC
        `).all();
        res.json({ ok: true, approvals });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.post('/api/approvals/:id/approve', (req, res) => {
    try {
        const db = getDb();
        const { approvedValue } = req.body;
        const approval = db.prepare('SELECT * FROM approvals WHERE id = ? AND status = ?').get(req.params.id, 'pending') as any;
        if (!approval) return res.status(404).json({ ok: false, error: 'Approval not found or already processed' });

        db.prepare('UPDATE approvals SET status = ?, approved_by = ?, approved_at = datetime(\'now\'), approved_value = ? WHERE id = ?')
            .run('approved', req.body.approvedBy || 'CEO', approvedValue || approval.proposed_value, req.params.id);

        const updated = db.prepare('SELECT * FROM approvals WHERE id = ?').get(req.params.id);
        res.json({ ok: true, message: 'Approved', approval: updated });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.post('/api/approvals/:id/reject', (req, res) => {
    try {
        const db = getDb();
        const approval = db.prepare('SELECT * FROM approvals WHERE id = ? AND status = ?').get(req.params.id, 'pending') as any;
        if (!approval) return res.status(404).json({ ok: false, error: 'Approval not found or already processed' });

        db.prepare('UPDATE approvals SET status = ?, rejected_reason = ?, approved_at = datetime(\'now\') WHERE id = ?')
            .run('rejected', req.body.reason || '', req.params.id);

        res.json({ ok: true, message: 'Rejected' });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ── Execution ───────────────────────────────────────────
router.post('/api/execute', async (req, res) => {
    try {
        const { approvalId, storeId, campaignSnapshotId, actionType, approvedValue, mode } = req.body;
        if (!approvalId) {
            return res.status(400).json({ ok: false, error: 'Missing required field: approvalId' });
        }
        const result = await executeApprovedChange({
            approvalId,
            storeId,
            campaignSnapshotId,
            actionType,
            approvedValue,
            mode,
        });
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

router.post('/api/approvals/:id/execute', async (req, res) => {
    try {
        const result = await executeApprovedChange({
            approvalId: req.params.id,
            mode: req.body?.mode === 'live' ? 'live' : 'dry_run',
            approvedValue: req.body?.approvedValue,
        });
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

router.post('/api/rollback', async (req, res) => {
    try {
        const { storeId, approvalId } = req.body;
        if (!storeId || !approvalId) {
            return res.status(400).json({ ok: false, error: 'Missing required fields: storeId, approvalId' });
        }
        const result = await executeRollback(storeId, approvalId);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

// ── Execution Logs ──────────────────────────────────────
router.get('/api/execution-logs', (_req, res) => {
    try {
        const db = getDb();
        const logs = db.prepare(`
            SELECT e.*, s.name as store_name 
            FROM execution_logs e 
            JOIN stores s ON e.store_id = s.id 
            ORDER BY e.executed_at DESC 
            LIMIT 100
        `).all();
        res.json({ ok: true, logs });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.get('/api/dashboard', (_req, res) => {
    try {
        const db = getDb();
        const pendingApprovals = (db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`).get() as any)?.n ?? 0;
        const approvedPendingExecution = (db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'approved' AND executed_at IS NULL`).get() as any)?.n ?? 0;
        const campaignsToday = (db.prepare(`SELECT COUNT(*) AS n FROM campaign_snapshots WHERE DATE(created_at) = DATE('now')`).get() as any)?.n ?? 0;
        const executionsToday = (db.prepare(`SELECT COUNT(*) AS n FROM execution_logs WHERE DATE(executed_at) = DATE('now')`).get() as any)?.n ?? 0;
        res.json({ ok: true, pendingApprovals, approvedPendingExecution, campaignsToday, executionsToday });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ── Audit Log ───────────────────────────────────────────
router.get('/api/audit-log', (_req, res) => {
    try {
        const db = getDb();
        const logs = db.prepare(`
            SELECT * FROM audit_log 
            ORDER BY created_at DESC 
            LIMIT 200
        `).all();
        res.json({ ok: true, logs });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ── Weekly Loop ─────────────────────────────────────────
router.post('/api/audit/campaigns/run', async (req, res) => {
    try {
        const result = await runCampaignAudit({
            autonomousAdjustments: req.body?.autonomousAdjustments === true,
            executionMode: req.body?.executionMode === 'live' ? 'live' : 'dry_run',
            approvedBy: req.body?.approvedBy,
        });
        res.json({ ok: true, report: result });
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

router.get('/api/ai-browser/status', (_req, res) => {
    try {
        res.json({
            ok: true,
            stagehand: getStagehandRuntimeStatus(),
            qa: {
                provider: process.env['BROWSER_USE_QA_ENABLED'] === 'true' ? 'browser-use-compatible' : 'deterministic',
                browserUseCommandConfigured: Boolean(process.env['BROWSER_USE_COMMAND'] || process.env['DD_BROWSER_USE_COMMAND']),
            },
        });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.post('/api/weekly-loop/trigger', async (_req, res) => {
    try {
        const result = await triggerManualLoop();
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

router.get('/api/weekly-loop/last', (_req, res) => {
    try {
        const lastRun = getLastLoopRun();
        res.json({ ok: true, lastRun });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ── MI-CORE Sync ────────────────────────────────────────
router.get('/api/mi-core/status', (_req, res) => {
    try {
        const state = getMiCoreSyncState();
        res.json({ ok: true, ...state });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.post('/api/mi-core/sync', async (_req, res) => {
    try {
        const result = await syncWithMiCore();
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
    }
});

// ── Stores ──────────────────────────────────────────────
router.get('/api/stores', (_req, res) => {
    try {
        const db = getDb();
        const stores = db.prepare('SELECT * FROM stores WHERE active = 1').all();
        res.json({ ok: true, stores });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.put('/api/stores/:id', (req, res) => {
    try {
        const db = getDb();
        const { name, email } = req.body;
        if (name || email) {
            const updates: string[] = [];
            const params: any[] = [];
            if (name) { updates.push('name = ?'); params.push(name); }
            if (email) { updates.push('email = ?'); params.push(email); }
            updates.push('updated_at = datetime(\'now\')');
            params.push(req.params.id);
            db.prepare(`UPDATE stores SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }
        res.json({ ok: true, message: 'Store updated' });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ── Heartbeat ───────────────────────────────────────────
router.post('/api/heartbeat', (req, res) => {
    try {
        const db = getDb();
        const body = req.body;

        // Store heartbeat data
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
            .run(`heartbeat_${body.machine_id || 'unknown'}`, JSON.stringify({
                ...body,
                received_at: new Date().toISOString(),
            }));

        res.json({ ok: true, message: 'Heartbeat received' });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

export default router;
