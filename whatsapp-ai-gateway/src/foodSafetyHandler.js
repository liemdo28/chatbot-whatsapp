/**
 * foodSafetyHandler.js — CEO DIRECTIVE LOCKDOWN (Option C numeric-only)
 *
 * This file historically contained the full legacy OCR/Vision pipeline
 * (processSubmissionBatch, processLegacyOcrPath, processGpt4oPath,
 *  Vision LLM bridge, OpenAI Vision, PaddleOCR, decision engine,
 *  zero-retake reply builder, runtime proof blocks, etc.).
 *
 * Per CEO Directive — Food Safety Source Cleanup & Legacy Workflow Removal,
 * ALL of those code paths are RETIRED for Food Safety production groups.
 *
 * The ONLY active workflow for Food Safety production groups is:
 *   /agent → 19 numeric values → confirm/edit/re-enter/cancel → DB save
 *
 * This file now exposes a thin shim whose implementations delegate to:
 *   - FoodSafetyNumericRouter  → message routing & reply generation
 *   - numericTextHandler       → session state, validation, save, sheet sync
 *
 * The legacy OCR/Vision functions are kept as EXPORTS (so old test suites
 * and any historical tooling continue to load without crashing), but they
 * are no longer called from any production code path. They immediately
 * raise so they cannot accidentally run during the controlled pilot.
 *
 * Hard rule: Food Safety production groups NEVER reach:
 *   - performOCR / Tesseract
 *   - PaddleOCR / paddleocr_bridge
 *   - vision_llm_bridge (Gemini Flash)
 *   - openaiVision.extractForm (OpenAI/GPT-4o)
 *   - processSubmissionBatch
 *   - processLegacyOcrPath
 *   - processGpt4oPath
 *   - appendProof / Runtime proof blocks
 */

const db = require("./database");
const logger = require("./logger");
const { t } = require("./language");
const numericTextHandler = require("./numericTextHandler");
const numericRouter = require("./foodSafetyNumericRouter");
const { isFoodSafetyPilotGroup, getFoodSafetyPilotScope, getPhotoInstruction, PHOTO_WORKFLOW_RETIRED_REPLY, SHORT_PHOTO_INSTRUCTION } = require("./foodSafetyPilotGuard");

// Wire numeric text handler to share sessions with the shim layer.
let _sessionProvider = null;
let _messageIdProvider = null;

// In-memory session store — used by default when no external provider is wired.
// The numeric text handler reads via setSessionProvider; we wire our own
// provider below at module load.
const _localSessions = {};

function getSession(phoneNumber) {
    if (_sessionProvider) return _sessionProvider(phoneNumber);
    if (!_localSessions[phoneNumber]) {
        _localSessions[phoneNumber] = {
            language: "ES",
            pendingSubmission: null,
            pendingStoreConfirmation: null,
            waitingFor: null,
            lastImageHash: null,
        };
    }
    return _localSessions[phoneNumber];
}

function getMessageId(message) {
    if (_messageIdProvider) return _messageIdProvider(message);
    return message && message.id && message.id._serialized
        ? message.id._serialized
        : String(message && message.id ? message.id : "");
}

// Wire numericTextHandler to use our local session store by default.
numericTextHandler.setSessionProvider(getSession);
numericTextHandler.setMessageIdProvider(getMessageId);
numericRouter.__setSessionProvider(getSession);
numericRouter.__setMessageIdProvider(getMessageId);

function getChatName(message) {
    return message && (message._chatName || (message._data && message._data.chatName)) || "";
}

function buildFoodSafetyAgentReply(message) {
    const scope = getFoodSafetyPilotScope(message);
    if (!isFoodSafetyPilotGroup(scope)) return null;
    if (scope.role === "production_log" && scope.storeInfo) {
        return numericTextHandler.buildChecklist(scope.storeInfo);
    }
    if (scope.role === "logtest") {
        return numericTextHandler.buildChecklist({ storeName: "Test Checklist (Stone Oak)", routingSource: "logtest" });
    }
    return null;
}

// ─── PUBLIC API — what other modules still call ────────────────────────────

/**
 * Image handler for Food Safety groups.
 * Returns:
 *   - string  → reply text to send
 *   - null    → silent ignore (preferred for Option C pilot)
 *
 * NEVER returns an OCR/Vision reply. NEVER returns "This form needs review".
 */
async function handleImageMessage(message, client) {
    const scope = getFoodSafetyPilotScope(message);
    if (isFoodSafetyPilotGroup(scope)) {
        const phone = message.from;
        const chatName = getChatName(message);
        logger.info("[OPTION_C_LOCKDOWN] Photo workflow retired for Food Safety pilot group", {
            phone, chatName, role: scope.role,
            store: scope.storeInfo ? scope.storeInfo.storeName : null,
        });
        db.logMessage(phone, "in", "[photo rejected: option c numeric workflow only]", "image");

        const instruction = getPhotoInstruction(phone);
        if (instruction) {
            db.logMessage(phone, "out", instruction, "text");
            return instruction;
        }
        return null; // silent ignore
    }
    // Non-pilot groups: still blocked — CEO directive applies to all FS groups.
    logger.warn("[OPTION_C_LOCKDOWN] Image received for non-pilot group; refusing (CEO directive)", {
        from: message.from, chatName: getChatName(message),
    });
    return PHOTO_WORKFLOW_RETIRED_REPLY;
}

/**
 * Text handler for Food Safety groups.
 * Delegates entirely to the numeric text handler so the workflow is single-sourced.
 */
async function handleTextMessage(message, client) {
    const phone = message.from;
    const body = (message.body || "").trim();
    const session = getSession(phone);
    db.logMessage(phone, "in", body, "text");

    // /agent
    if (body.toUpperCase() === "/AGENT") {
        const reply = buildFoodSafetyAgentReply(message);
        if (reply) {
            db.logMessage(phone, "out", reply, "text");
            return reply;
        }
    }

    // Pending numeric action state
    if (session.waitingFor === "numeric_action" && session.pendingSubmission) {
        const reply = await numericTextHandler.handleNumericTextMessage(message, client);
        if (reply) return reply;
        const rePrompt = "Please reply:\n1 = Confirm\n2 = Edit\n3 = Re-enter All\n4 = Cancel";
        db.logMessage(phone, "out", rePrompt, "text");
        return rePrompt;
    }

    // Fresh numeric list
    if (numericTextHandler.isNumericList(body)) {
        const reply = await numericTextHandler.handleNumericTextMessage(message, client);
        if (reply) return reply;
    }

    // Team support commands (kept for parity with prior behavior)
    const upperBody = body.toUpperCase().trim();
    if (upperBody === "/HELP" || upperBody === "/H") {
        const reply = t(session.language, "team_help");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    if (upperBody === "/STATUS") {
        const waStatus = require("./clientManager").getStatus().status;
        const sheetConfigured = !!(process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_PATH);
        const reply = t(session.language, "team_status", {
            status: waStatus,
            sheet: sheetConfigured ? "Configurado" : "Pendiente (modo seguro)",
        });
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    if (upperBody === "/LOG") {
        const subs = db.getSubmissions({ limit: 5 });
        let reply = session.language === "EN" ? "Recent submissions:\n" : "Env\u00EDos recientes:\n";
        if (subs.length === 0) {
            reply += session.language === "EN" ? "No submissions yet." : "Sin env\u00EDos a\u00FAn.";
        } else {
            for (const s of subs) {
                reply += `#${s.id} - ${s.store_name} - ${s.status} - ${s.created_at}\n`;
            }
        }
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    // Nothing matched — let the rest of the system handle it (or fall silent).
    return null;
}

// ─── LEGACY EXPORTS — RETIRED ───────────────────────────────────────────────
// These remain exported ONLY so historical test files and tooling can still
// `require()` the module without crashing. Calling any of them is now a
// programming error: they immediately throw to make accidental reachability
// impossible.

function _retired(reason) {
    return function retired() {
        const err = new Error(`[FOOD_SAFETY_RETIRED] ${reason}`);
        err.code = "FOOD_SAFETY_RETIRED";
        logger.error(`[FOOD_SAFETY_RETIRED] ${reason}`);
        throw err;
    };
}

const processSubmissionBatch = _retired(
    "processSubmissionBatch is retired. Food Safety groups are routed via FoodSafetyNumericRouter (numeric-only)."
);

const processLegacyOcrPath = _retired(
    "processLegacyOcrPath is retired. Tesseract OCR pipeline is disabled for Food Safety production groups."
);

const processGpt4oPath = _retired(
    "processGpt4oPath is retired. Vision LLM pipeline is disabled for Food Safety production groups."
);

const callVisionPrimary = _retired(
    "callVisionPrimary is retired. Vision providers (Gemini Flash, OpenAI/GPT-4o) are disabled for Food Safety groups."
);

const performImageOCR = _retired(
    "performImageOCR is retired. OCR is disabled for Food Safety production groups."
);

// Legacy test-only hooks — keep signatures but make them no-ops + warn.
function setOcrProcessorForTests() {
    logger.warn("[FOOD_SAFETY_RETIRED] setOcrProcessorForTests is a no-op in numeric-only mode");
}
function setPaddleBridgeForTests() {
    logger.warn("[FOOD_SAFETY_RETIRED] setPaddleBridgeForTests is a no-op in numeric-only mode");
}
function resetProcessingCachesForTests() {
    /* no-op */
}

// ─── SESSION / NAMESPACE EXPORTS ────────────────────────────────────────────
// Exposed for backward compatibility. The numeric text handler owns the
// actual state; this is just a thin re-export.
const sessions = {};

function setSessionProvider(fn) {
    _sessionProvider = fn;
    numericTextHandler.setSessionProvider(fn);
}
function setMessageIdProvider(fn) {
    _messageIdProvider = fn;
    numericTextHandler.setMessageIdProvider(fn);
}

module.exports = {
    // Production router (preferred entry point)
    handleFoodSafetyMessage: numericRouter.handleFoodSafetyMessage,
    getRouterLockdownProof: numericRouter.getRouterLockdownProof,
    getWorkflowMode: numericRouter.getWorkflowMode,
    legacyImageFlowEnabled: numericRouter.legacyImageFlowEnabled,

    // Active handlers (still used by clientManager + numeric flow)
    handleImageMessage,
    handleTextMessage,
    buildFoodSafetyAgentReply,

    // Session helpers (kept for back-compat)
    getSession,
    getMessageId,
    sessions,
    setSessionProvider,
    setMessageIdProvider,

    // Test-only hooks (no-ops in numeric-only mode)
    setOcrProcessorForTests,
    setPaddleBridgeForTests,
    resetProcessingCachesForTests,

    // RETIRED — preserved for module-load compatibility only.
    // Calling any of these throws FOOD_SAFETY_RETIRED.
    processSubmissionBatch,
    processLegacyOcrPath,
    processGpt4oPath,
    callVisionPrimary,
    performImageOCR,
};