const crypto = require("crypto");
const logger = require("./logger");
const db = require("./database");

const REQUIRED_STEPS = [
    "IMAGE_RECEIVED",
    "HANDLER_SELECTED",
    "ROUTER_STARTED",
    "GROUP_RESOLVED",
    "FORM_CLASSIFIED",
    "STORE_RESOLVED",
    "QUALITY_GATE_DONE",
    "PIPELINE_SELECTED",
    "OCR_DONE",
    "GPT4O_VISION_CALLED",
    "MEMORY_DONE",
    "WRITER_PROFILE_DONE",
    "STORE_KNOWLEDGE_DONE",
    "VISION_REVIEW_DONE",
    "DECISION_ENGINE_DONE",
    "ALERT_COMPOSER_DONE",
    "REPLY_BUILDER_DONE",
    "DB_WRITE_DONE",
    "SHEET_SYNC_DONE",
    "WHATSAPP_REPLY_SENT",
    "PILOT_METRIC_RECORDED",
];

let tablesEnsured = false;

function envList(name) {
    const raw = process.env[name];
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String).map((v) => v.trim()).filter(Boolean);
    } catch (_) {
        // Fall back to comma splitting.
    }
    return String(raw).split(",").map((v) => v.trim()).filter(Boolean);
}

function normalize(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function createTraceId(now = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
    ].join("") + "-" + [
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join("");
    const shortId = crypto.randomBytes(2).toString("hex").toUpperCase();
    return `FS-${stamp}-${shortId}`;
}

function isEnabledFor({ chatId, chatName } = {}) {
    if (String(process.env.HYBRID_TRACE_ENABLED || "true").toLowerCase() === "false") return false;
    if (String(process.env.HYBRID_TRACE_GROUPS_STRICT || "false").toLowerCase() !== "true") return true;
    const allowed = envList("HYBRID_TRACE_GROUPS");
    if (allowed.length === 0) return true;
    const id = String(chatId || "");
    const name = normalize(chatName);
    return allowed.some((entry) => entry === id || normalize(entry) === name);
}

function ensureTables() {
    if (tablesEnsured) return;
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS pipeline_trace_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                submission_id TEXT,
                chat_id TEXT,
                chat_name TEXT,
                sender TEXT,
                image_id TEXT,
                step TEXT NOT NULL,
                status TEXT NOT NULL,
                input_summary TEXT,
                output_summary TEXT,
                duration_ms INTEGER,
                error TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT,
                submission_id TEXT,
                event_type TEXT,
                step TEXT,
                status TEXT,
                chat_id TEXT,
                chat_name TEXT,
                payload_json TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS decision_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT,
                submission_id TEXT,
                step TEXT,
                status TEXT,
                decision_json TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS pilot_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT,
                submission_id TEXT,
                metric_name TEXT,
                metric_value TEXT,
                payload_json TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.run(`CREATE INDEX IF NOT EXISTS idx_pipeline_trace_id ON pipeline_trace_events(trace_id, id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_audit_events_trace ON audit_events(trace_id, id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_decision_audit_trace ON decision_audit(trace_id, id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_pilot_metrics_trace ON pilot_metrics(trace_id, id)`);
        db.saveDb();
        tablesEnsured = true;
    } catch (err) {
        logger.warn("[PIPELINE_TRACE] Table init failed", { error: err.message });
    }
}

function safeJson(value) {
    if (value === undefined) return null;
    if (value === null) return null;
    try {
        return JSON.stringify(value);
    } catch (_) {
        return JSON.stringify({ value: String(value) });
    }
}

function start(context = {}) {
    const enabled = isEnabledFor(context);
    const trace = {
        enabled,
        trace_id: enabled ? createTraceId() : null,
        submission_id: context.submissionId || null,
        chat_id: context.chatId || "",
        chat_name: context.chatName || "",
        sender: context.sender || "",
        image_id: context.imageId || "",
        lastStepAt: Date.now(),
    };
    if (enabled) ensureTables();
    return trace;
}

function setSubmissionId(trace, submissionId) {
    if (!trace) return;
    trace.submission_id = submissionId !== undefined && submissionId !== null ? String(submissionId) : null;
}

function step(trace, stepName, status, details = {}) {
    if (!trace || !trace.enabled) return null;
    ensureTables();
    const now = Date.now();
    const durationMs = details.duration_ms !== undefined ? details.duration_ms : now - (trace.lastStepAt || now);
    trace.lastStepAt = now;

    const payload = {
        trace_id: trace.trace_id,
        submission_id: details.submission_id || trace.submission_id || null,
        chat_id: trace.chat_id,
        chat_name: trace.chat_name,
        sender: trace.sender,
        image_id: trace.image_id,
        step: stepName,
        status,
        input_summary: details.input_summary || null,
        output_summary: details.output_summary || null,
        duration_ms: durationMs,
        error: details.error ? String(details.error) : null,
    };

    logger.info("[PIPELINE_TRACE]", payload);

    try {
        db.run(
            `INSERT INTO pipeline_trace_events
               (trace_id, submission_id, chat_id, chat_name, sender, image_id, step, status,
                input_summary, output_summary, duration_ms, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.trace_id,
                payload.submission_id,
                payload.chat_id,
                payload.chat_name,
                payload.sender,
                payload.image_id,
                payload.step,
                payload.status,
                safeJson(payload.input_summary),
                safeJson(payload.output_summary),
                payload.duration_ms,
                payload.error,
            ]
        );
        db.run(
            `INSERT INTO audit_events
               (trace_id, submission_id, event_type, step, status, chat_id, chat_name, payload_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.trace_id,
                payload.submission_id,
                "HYBRID_PIPELINE_TRACE",
                payload.step,
                payload.status,
                payload.chat_id,
                payload.chat_name,
                safeJson(payload),
            ]
        );
        db.run(
            `INSERT INTO decision_audit
               (trace_id, submission_id, step, status, decision_json)
             VALUES (?, ?, ?, ?, ?)`,
            [
                payload.trace_id,
                payload.submission_id,
                payload.step,
                payload.status,
                safeJson({
                    input_summary: payload.input_summary,
                    output_summary: payload.output_summary,
                    error: payload.error,
                }),
            ]
        );
        db.run(
            `INSERT INTO pilot_metrics
               (trace_id, submission_id, metric_name, metric_value, payload_json)
             VALUES (?, ?, ?, ?, ?)`,
            [
                payload.trace_id,
                payload.submission_id,
                `pipeline.${payload.step}`,
                payload.status,
                safeJson(payload),
            ]
        );
        db.saveDb();
    } catch (err) {
        logger.warn("[PIPELINE_TRACE] DB write failed", { trace_id: trace.trace_id, step: stepName, error: err.message });
    }
    return payload;
}

function footer(trace) {
    if (!trace || !trace.enabled || !trace.trace_id) return "";
    return `Trace: ${trace.trace_id}`;
}

function appendFooter(reply, trace) {
    const foot = footer(trace);
    if (!foot) return reply;
    return `${reply}\n\n${foot}`;
}

function getRecent(limit = 100) {
    ensureTables();
    return db.getAll(
        `SELECT * FROM pipeline_trace_events ORDER BY id DESC LIMIT ?`,
        [Number(limit) || 100]
    );
}

module.exports = {
    REQUIRED_STEPS,
    createTraceId,
    isEnabledFor,
    start,
    setSubmissionId,
    step,
    footer,
    appendFooter,
    ensureTables,
    getRecent,
};
