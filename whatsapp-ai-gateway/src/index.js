const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
require("dotenv").config();

const logger = require("./logger");
const db = require("./database");
const clientManager = require("./clientManager");
const gsheet = require("./googleSheet");
const { handleTextMessage, getSession } = require("./foodSafetyHandler");
const numericRouter = require("./foodSafetyNumericRouter");
const { getSubmissionStatus, detectMissingSubmissions } = require("./missingSubmissionDetector");
const scheduler = require("./missingSubmissionScheduler");
const clientManagerRef = clientManager;
const pipelineTrace = require("./pipelineTrace");

// ─── Handwriting Memory System ──────────────────────────────────────────────
const { registerHandwritingRoutes } = require("./handwriting/api");
const { registerGbpRoutes } = require("./gbp/api");

const app = express();
const PORT = process.env.GATEWAY_PORT || 3211;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// File upload config
const upload = multer({
    dest: path.join(__dirname, "..", "data", "uploads"),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only images allowed"));
        }
    },
});

// ===== API Routes =====

// WhatsApp session status
app.get("/api/whatsapp/session", (req, res) => {
    try {
        const status = clientManager.getStatus();
        const dbStatus = db.getWhatsAppSessionStatus();
        res.json({
            status: status.status,
            dbStatus: dbStatus,
            lastError: status.lastError,
            reconnectAttempts: status.reconnectAttempts,
            hasQR: status.lastQR,
            timestamp: status.timestamp,
        });
    } catch (err) {
        logger.error("Error getting session status", { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// WhatsApp QR code (raw)
app.get("/api/whatsapp/qr", (req, res) => {
    const qrData = clientManager.getQRData();
    if (qrData && qrData.raw) {
        res.type("text/plain").send(qrData.raw);
    } else {
        res.status(404).json({ error: "No QR code available" });
    }
});

// WhatsApp QR code (image)
app.get("/api/whatsapp/qr-image", (req, res) => {
    const qrData = clientManager.getQRData();
    if (qrData && qrData.dataUrl) {
        res.json({ dataUrl: qrData.dataUrl });
    } else {
        res.status(404).json({ error: "No QR image available" });
    }
});

// Connect WhatsApp
app.post("/api/whatsapp/connect", async (req, res) => {
    try {
        await clientManager.initializeClient();
        res.json({ success: true, message: "Client initialization started" });
    } catch (err) {
        logger.error("Connect failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// Reset WhatsApp session
app.post("/api/whatsapp/reset", async (req, res) => {
    try {
        const result = await clientManager.resetSession();
        res.json(result);
    } catch (err) {
        logger.error("Reset failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// Reconnect WhatsApp
app.post("/api/whatsapp/reconnect", async (req, res) => {
    try {
        await clientManager.reconnect();
        res.json({ success: true, message: "Reconnect started" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send message
app.post("/api/whatsapp/send", async (req, res) => {
    if (String(process.env.ALLOW_MANUAL_WHATSAPP_SEND || "false").toLowerCase() !== "true") {
        return res.status(403).json({
            error: "DISABLED",
            reason: "Manual WhatsApp sends bypass the canonical Food Safety reply/alert/reminder paths.",
        });
    }
    const { to, message } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: "Missing 'to' or 'message'" });
    }
    try {
        await clientManager.sendMessage(to, message);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List WhatsApp groups from the live connected client for validation evidence.
app.get("/api/whatsapp/groups", async (req, res) => {
    try {
        const status = clientManager.getStatus();
        if (status.status !== "CONNECTED") {
            return res.status(503).json({ ok: false, status: status.status, error: "WhatsApp client not connected" });
        }

        const client = clientManager.getClient();
        const chats = await client.getChats();
        const groups = chats
            .filter((chat) => chat.isGroup)
            .map((chat) => ({
                id: chat.id && chat.id._serialized ? chat.id._serialized : "",
                name: chat.name || "",
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json({ ok: true, groups, timestamp: new Date().toISOString() });
    } catch (err) {
        logger.error("Error listing WhatsApp groups", { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ===== Food Safety API =====

// CEO DIRECTIVE — Food Safety Source Cleanup & Legacy Workflow Removal:
// The only active Food Safety workflow is Option C: Numeric Text Entry.
// All submissions MUST go through WhatsApp → FoodSafetyNumericRouter.
// Legacy OCR/Vision pipelines are retired and unreachable.
app.post("/api/food-safety/submit", upload.single("image"), (req, res) => {
    return res.status(403).json({
        error: "DISABLED — All submissions must go through WhatsApp group chat using Option C numeric workflow.",
        reason: "Legacy OCR/Vision pipelines have been retired (CEO directive). Numeric text entry is the only active workflow.",
        required_path: "WhatsApp -> FoodSafetyNumericRouter -> /agent -> 19 numeric values -> 1=Confirm -> DB save + Google Sheet sync",
    });
});

// Get all submissions
app.get("/api/food-safety/submissions", (req, res) => {
    try {
        const subs = db.getSubmissions({
            store_name: req.query.store,
            status: req.query.status,
            limit: parseInt(req.query.limit) || 50,
        });
        res.json(subs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single submission
app.get("/api/food-safety/submissions/:id", (req, res) => {
    try {
        const sub = db.getSubmission(parseInt(req.params.id));
        if (!sub) return res.status(404).json({ error: "Not found" });
        res.json(sub);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Process text command for a submission
app.post("/api/food-safety/command", async (req, res) => {
    if (String(process.env.FOOD_SAFETY_ALLOW_API_COMMANDS || "false").toLowerCase() !== "true") {
        return res.status(403).json({
            error: "DISABLED",
            reason: "Food Safety commands must arrive through WhatsApp so confirmation cannot bypass the live pipeline.",
        });
    }
    const { phone, command } = req.body;
    if (!phone || !command) {
        return res.status(400).json({ error: "Missing phone or command" });
    }
    try {
        const fakeMsg = { from: phone, body: command, hasMedia: false, type: "text" };
        const reply = await handleTextMessage(fakeMsg, null);
        res.json({ reply: reply });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Google Sheet sync status
app.get("/api/food-safety/sync-status", (req, res) => {
    res.json({
        googleSheetsConfigured: !!(process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_PATH),
        message: "Google Sheet sync is safe-failure: local DB always saves first",
    });
});

app.get("/api/food-safety/pipeline-trace", (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const traceId = req.query.trace_id ? String(req.query.trace_id) : null;
        pipelineTrace.ensureTables();
        const rows = traceId
            ? db.getAll(`SELECT * FROM pipeline_trace_events WHERE trace_id = ? ORDER BY id ASC`, [traceId])
            : db.getAll(`SELECT * FROM pipeline_trace_events ORDER BY id DESC LIMIT ?`, [limit]);
        res.json({ ok: true, trace_id: traceId, rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// CEO DIRECTIVE — Food Safety Source Cleanup & Legacy Workflow Removal:
// Runtime proof now advertises the locked numeric-only path.
// All Vision / OCR / Runtime-proof-with-legacy-markers fields are REMOVED.
app.get("/api/runtime/proof", (req, res) => {
    try {
        const files = [
            "src/index.js",
            "src/foodSafetyHandler.js",
            "src/foodSafetyNumericRouter.js",
            "src/foodSafetyPilotGuard.js",
            "src/numericTextHandler.js",
            "src/clientManager.js",
            "src/database.js",
        ];
        const sourceFiles = files.map((file) => {
            const fullPath = path.join(__dirname, "..", file);
            const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
            return {
                file,
                exists: !!stat,
                mtime: stat ? stat.mtime.toISOString() : null,
                size: stat ? stat.size : null,
            };
        });
        const routerProof = numericRouter.getRouterLockdownProof();
        res.json({
            ok: true,
            pid: process.pid,
            cwd: process.cwd(),
            argv: process.argv,
            port: PORT,
            active_runtime_path: {
                workflow_mode: routerProof.workflow_mode,
                legacy_image_flow_enabled: routerProof.legacy_image_flow_enabled,
                dispatcher: "clientManager.unifiedHandler",
                food_safety_router: routerProof.router,
                active_workflow: "Option C Numeric Text Entry",
                pipeline: "WhatsApp -> FoodSafetyNumericRouter -> numericTextHandler",
                accepts: routerProof.accepts,
                rejects: routerProof.rejects,
                execution_path_count: 1,
                whatsapp_reply_count: 1,
            },
            env: {
                FOOD_SAFETY_WORKFLOW_MODE: process.env.FOOD_SAFETY_WORKFLOW_MODE || "numeric",
                ENABLE_LEGACY_FOOD_SAFETY_IMAGE_FLOW: process.env.ENABLE_LEGACY_FOOD_SAFETY_IMAGE_FLOW || "false",
                USE_VISION_LLM_PIPELINE: process.env.USE_VISION_LLM_PIPELINE || "false",
                VISION_REVIEW_ENABLED: process.env.VISION_REVIEW_ENABLED || "false",
            },
            sourceFiles,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ===== Dashboard Routes =====

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "dashboard.html"));
});

app.get("/qr", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "qr.html"));
});

// GBP Dashboard
app.get("/gbp", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "gbp-dashboard.html"));
});

// ===== Missing Submission Alert API =====

// Dashboard panel — submission status for all stores
app.get("/api/missing-submissions/status", (req, res) => {
    try {
        const status = getSubmissionStatus();
        res.json({ ok: true, stores: status, timestamp: new Date().toISOString() });
    } catch (err) {
        logger.error("Error getting submission status", { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// Manual check — trigger detection now
app.post("/api/missing-submissions/check", async (req, res) => {
    try {
        const result = await scheduler.runCheck();
        res.json({ ok: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Test-only live trigger for the post-submission peer reminder path.
app.post("/api/missing-submissions/peer-check", async (req, res) => {
    try {
        const submittedStoreCode = req.body.store_code || req.query.store_code;
        if (!submittedStoreCode) {
            return res.status(400).json({ ok: false, error: "Missing store_code" });
        }
        const result = await scheduler.runPeerMissingCheck(String(submittedStoreCode).toUpperCase());
        res.json({ ok: true, result });
    } catch (err) {
        logger.error("Peer missing check trigger failed", { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Scheduler status
app.get("/api/missing-submissions/scheduler", (req, res) => {
    res.json({ ok: true, ...scheduler.getStatus() });
});

// Start/stop scheduler
app.post("/api/missing-submissions/scheduler/start", (req, res) => {
    const intervalMs = req.body.interval_ms || 60000;
    scheduler.start(intervalMs);
    res.json({ ok: true, ...scheduler.getStatus() });
});

app.post("/api/missing-submissions/scheduler/stop", (req, res) => {
    scheduler.stop();
    res.json({ ok: true, ...scheduler.getStatus() });
});

// ===== Health Check =====

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        whatsapp: clientManager.getStatus().status,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

// ===== Start Server =====

async function start() {
    logger.info("Starting WhatsApp AI Gateway", { port: PORT });

    // Initialize database
    db.getDb();
    logger.info("Database ready");

    // Try to init Google Sheets (non-blocking if not configured)
    gsheet.initGoogleSheets().catch((e) => {
        logger.warn("Google Sheets init failed (non-blocking)", { error: e.message });
    });

    // Start Express
    app.listen(PORT, () => {
        logger.info(`Gateway server running on http://127.0.0.1:${PORT}`);
        console.log(`\n  ✅ WhatsApp AI Gateway`);
        console.log(`  🌐 Dashboard: http://127.0.0.1:${PORT}/`);
        console.log(`  📱 QR Page:   http://127.0.0.1:${PORT}/qr`);
        console.log(`  📊 API:       http://127.0.0.1:${PORT}/api/whatsapp/session\n`);
    });

    // Initialize missing submission alert system
    // Ensure DB is ready first, then create tables
    try {
        const { setClientManager: setAlertClientManager } = require("./managerAlertService");
        const { ensureTable } = require("./alertAuditLog");
        setAlertClientManager(clientManager);
        // Wait for DB to be ready before creating alert tables
        await db.getDb().then(() => { ensureTable(); });
        scheduler.start(60000); // Check every 60 seconds
        logger.info("Missing submission alert scheduler started");
    } catch (err) {
        logger.error("Alert scheduler init failed (non-blocking)", { error: err.message });
    }

    // Initialize pilot telemetry tables (CRITICAL — must be before any submissions)
    try {
        const pilot = require("./pilot/livePilotMetrics");
        await db.getDb().then(() => { pilot.initPilotTables(); });
        logger.info("Pilot telemetry tables initialized");
    } catch (err) {
        logger.error("Pilot telemetry init failed (non-blocking)", { error: err.message });
    }

    // Initialize capture rate dashboard tables
    try {
        const captureRate = require("./captureRateDashboard");
        await db.getDb().then(() => { captureRate.initCaptureRateTables(); });
        logger.info("Capture rate dashboard tables initialized");
    } catch (err) {
        logger.error("Capture rate init failed (non-blocking)", { error: err.message });
    }

    // Initialize handwriting memory system (Phase 15)
    try {
        registerHandwritingRoutes(app);
        logger.info("Handwriting memory system initialized");
    } catch (err) {
        logger.error("Handwriting memory init failed (non-blocking)", { error: err.message });
    }

    // Initialize Google Business Profile integration (DEV1 — GBP Activation)
    try {
        registerGbpRoutes(app);
        const gbpDb = require("./gbp/gbp-database");
        await gbpDb.initTables();
        logger.info("GBP API routes registered and tables initialized");
    } catch (err) {
        logger.error("GBP init failed (non-blocking)", { error: err.message });
    }

    // Initialize WhatsApp client
    try {
        await clientManager.initializeClient();
    } catch (err) {
        logger.error("WhatsApp client init failed (server still running)", { error: err.message });
    }
}

start().catch((err) => {
    logger.error("Fatal startup error", { error: err.message });
    process.exit(1);
});

module.exports = app;
