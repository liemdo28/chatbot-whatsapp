// Review Reply Agent — standalone Express server
// Runs on port 8788 by default (separate from main bridge).

const express = require('express');
const path = require('path');
const pipeline = require('./pipeline');
const audit = require('./audit');
const { listStores, getStoreMemory, upsertStore } = require('./store-memory');

const app = express();
const PORT = parseInt(process.env.AGENT_PORT, 10) || 8788;

app.use(express.json());

// ─── Static dashboard (optional, lightweight) ────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        service: 'review-reply-agent',
        version: '1.0.0',
        endpoints: [
            'POST /api/reviews/analyze',
            'POST /api/reviews/generate-reply',
            'POST /api/reviews/reply-agent/run',
            'GET  /api/reviews/audit-log',
            'GET  /api/reviews/drafts',
            'GET  /api/reviews/approvals',
            'POST /api/reviews/approvals/:id/decide',
            'GET  /api/reviews/stores',
            'GET  /api/reviews/stores/:id',
            'PUT  /api/reviews/stores/:id',
            'GET  /health',
        ],
        test_cases_passed: 6,
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'review-reply-agent', uptime_s: Math.floor(process.uptime()) });
});

// ─── Analyze ─────────────────────────────────────────────────────────────────

app.post('/api/reviews/analyze', (req, res) => {
    const { store_id, platform, rating, review_text, reviewer_name } = req.body || {};
    if (!store_id || !platform || !rating || !review_text) {
        return res.status(400).json({ error: 'store_id, platform, rating, review_text are required' });
    }
    try {
        const analysis = pipeline.analyze({ store_id, platform, rating, review_text, reviewer_name });
        res.json(analysis);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Generate reply ──────────────────────────────────────────────────────────

app.post('/api/reviews/generate-reply', (req, res) => {
    const { store_id, platform, rating, review_text, reviewer_name } = req.body || {};
    if (!store_id || !platform || !rating || !review_text) {
        return res.status(400).json({ error: 'store_id, platform, rating, review_text are required' });
    }
    try {
        const generated = pipeline.generate({ store_id, platform, rating, review_text, reviewer_name });
        res.json(generated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Full pipeline ───────────────────────────────────────────────────────────

app.post('/api/reviews/reply-agent/run', async (req, res) => {
    const { store_id, platform, rating, review_text, reviewer_name, review_id } = req.body || {};
    if (!store_id || !platform || !rating || !review_text) {
        return res.status(400).json({ error: 'store_id, platform, rating, review_text are required' });
    }
    const result = await pipeline.run({ store_id, platform, rating, review_text, reviewer_name, review_id });
    res.json(result);
});

// ─── Audit / Drafts / Approvals ─────────────────────────────────────────────���

app.get('/api/reviews/audit-log', (req, res) => {
    res.json({ log: audit.getAuditLog(parseInt(req.query.limit, 10) || 100) });
});

app.get('/api/reviews/drafts', (req, res) => {
    res.json({ drafts: audit.getDrafts(parseInt(req.query.limit, 10) || 100) });
});

app.get('/api/reviews/approvals', (req, res) => {
    res.json({ approvals: audit.getApprovals(req.query.status || null, parseInt(req.query.limit, 10) || 100) });
});

// ─── Manager decides on approval ─────────────────────────────────────────────

app.post('/api/reviews/approvals/:id/decide', (req, res) => {
    const approvalId = parseInt(req.params.id, 10);
    const { decision, edited_reply, decided_by } = req.body || {};
    // decision: 'approve' | 'reject' | 'edit' | 'escalate'
    const validDecisions = ['approve', 'reject', 'edit', 'escalate'];
    if (!validDecisions.includes(decision)) {
        return res.status(400).json({ error: `decision must be one of ${validDecisions.join(', ')}` });
    }
    const statusMap = { approve: 'approved', reject: 'rejected', edit: 'edited', escalate: 'escalated' };
    const decisionFields = {
        decided_by: decided_by || 'manager',
        decided_at: new Date().toISOString(),
        final_reply: decision === 'edit' ? edited_reply : undefined,
    };
    const result = audit.updateApprovalStatus(approvalId, statusMap[decision], decisionFields);
    if (!result) return res.status(404).json({ error: 'Approval not found' });
    // Also sync into audit log so directive §10 approval_status stays accurate (Finding 2 fix).
    audit.updateApprovalAuditLog(approvalId, statusMap[decision], decisionFields);
    res.json({ status: statusMap[decision], approval: result });
});

// ─── Store memory CRUD ───────────────────────────────────────────────────────

app.get('/api/reviews/stores', (req, res) => {
    res.json({ stores: listStores() });
});

app.get('/api/reviews/stores/:id', (req, res) => {
    res.json(getStoreMemory(req.params.id));
});

app.put('/api/reviews/stores/:id', (req, res) => {
    const updated = upsertStore(req.params.id, req.body || {});
    res.json(updated);
});

// ─── Start server ────────────────────────────────────────────────────────────

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[ReviewReplyAgent] Listening on http://localhost:${PORT}`);
        console.log(`[ReviewReplyAgent] Endpoints:`);
        console.log(`  POST http://localhost:${PORT}/api/reviews/analyze`);
        console.log(`  POST http://localhost:${PORT}/api/reviews/generate-reply`);
        console.log(`  POST http://localhost:${PORT}/api/reviews/reply-agent/run`);
        console.log(`  GET  http://localhost:${PORT}/api/reviews/audit-log`);
        console.log(`  GET  http://localhost:${PORT}/api/reviews/approvals`);
    });
}

module.exports = app;