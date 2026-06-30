// Audit log — JSON-backed store for every pipeline run.
// Required fields per CEO directive: review_id, store_id, platform, rating,
// review_text, detected_sentiment, detected_aspects, risk_level, draft_reply,
// auto_reply_allowed, approval_status, created_at, updated_at, error_message.

const fs = require('fs');
const path = require('path');

const AUDIT_PATH = path.join(__dirname, '..', 'data', 'review_reply_audit_logs.json');
const DRAFTS_PATH = path.join(__dirname, '..', 'data', 'review_reply_drafts.json');
const APPROVALS_PATH = path.join(__dirname, '..', 'data', 'review_reply_approvals.json');

function _load(file) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { /* fall through */ }
    return [];
}

function _save(file, data) {
    try {
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 4), 'utf8');
    } catch (e) {
        // Silent
    }
}

function _append(file, entry) {
    const list = _load(file);
    list.unshift(entry);
    if (list.length > 1000) list.length = 1000;
    _save(file, list);
    return entry;
}

function _nextId(list) {
    return list.length > 0 ? Math.max(...list.map(e => e.id || 0)) + 1 : 1;
}

function writeAuditLog(entry) {
    const list = _load(AUDIT_PATH);
    const id = entry.id || _nextId(list);
    const fullEntry = {
        id,
        review_id: entry.review_id || null,
        store_id: entry.store_id || null,
        platform: entry.platform || null,
        rating: entry.rating,
        review_text: entry.review_text || null,
        reviewer_name: entry.reviewer_name || null,
        detected_sentiment: entry.detected_sentiment || null,
        detected_aspects: entry.detected_aspects || [],
        risk_level: entry.risk_level || null,
        draft_reply: entry.draft_reply || null,
        auto_reply_allowed: entry.auto_reply_allowed ?? false,
        approval_status: entry.approval_status || 'pending',
        approval_id: entry.approval_id || null,
        created_at: entry.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: entry.error_message || null,
        metadata: entry.metadata || {},
    };
    return _append(AUDIT_PATH, fullEntry);
}

function saveDraft(draft) {
    const list = _load(DRAFTS_PATH);
    const id = draft.id || _nextId(list);
    return _append(DRAFTS_PATH, {
        id,
        ...draft,
        created_at: draft.created_at || new Date().toISOString(),
    });
}

function saveApproval(approval) {
    const list = _load(APPROVALS_PATH);
    const id = approval.id || _nextId(list);
    return _append(APPROVALS_PATH, {
        id,
        status: 'pending',
        ...approval,
        created_at: approval.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
    });
}

function updateApprovalStatus(approvalId, status, fields = {}) {
    const list = _load(APPROVALS_PATH);
    const idx = list.findIndex(a => a.id === approvalId);
    if (idx === -1) return null;
    list[idx] = {
        ...list[idx],
        status,
        ...fields,
        updated_at: new Date().toISOString(),
    };
    _save(APPROVALS_PATH, list);
    return list[idx];
}

// Sync approval status into audit log so directive §10 approval_status stays accurate.
function updateApprovalAuditLog(approvalId, status, fields = {}) {
    const list = _load(AUDIT_PATH);
    const idx = list.findIndex(e => e.approval_id === approvalId);
    if (idx === -1) return null;
    list[idx] = {
        ...list[idx],
        approval_status: status,
        ...(fields.decided_by ? { decided_by: fields.decided_by } : {}),
        ...(fields.decided_at ? { decided_at: fields.decided_at } : {}),
        ...(fields.final_reply ? { final_reply: fields.final_reply } : {}),
        updated_at: new Date().toISOString(),
    };
    _save(AUDIT_PATH, list);
    return list[idx];
}

function getAuditLog(limit = 100) {
    return _load(AUDIT_PATH).slice(0, limit);
}

function getDrafts(limit = 100) {
    return _load(DRAFTS_PATH).slice(0, limit);
}

function getApprovals(status = null, limit = 100) {
    let list = _load(APPROVALS_PATH);
    if (status) list = list.filter(a => a.status === status);
    return list.slice(0, limit);
}

module.exports = {
    writeAuditLog,
    saveDraft,
    saveApproval,
    updateApprovalStatus,
    updateApprovalAuditLog,
    getAuditLog,
    getDrafts,
    getApprovals,
    AUDIT_PATH,
    DRAFTS_PATH,
    APPROVALS_PATH,
};
