/**
 * foodSafetyNumericRouter.js — CEO DIRECTIVE: Option C Numeric Router Lockdown
 *
 * Single source of truth for Food Safety production message routing.
 *
 *   Inbound WhatsApp message in B1 / B2 / B3 / LD Agent-Logtest
 *                │
 *                ▼
 *   isFoodSafetyGroup(message)?
 *           │
 *          YES
 *           ▼
 *   FoodSafetyNumericRouter.handle(message)
 *           │
 *           ├─ image → photo suppression (silent / once-per-shift instruction)
 *           ├─ text  → numeric workflow (/agent, 19 numbers, 1/2/3/4, EDIT)
 *           └─ STOP  (no fallthrough, no Agent-Coding reply)
 *
 * HARD RULES
 *   • No OCR call.    No Vision call.    No Paddle call.    No Tesseract call.
 *   • No "This form needs review" reply.    No "Detected items" image reply.
 *   • No "OCR confidence" in any employee reply.
 *   • No template id (FoodSafety-StoneOak-v3) in any employee reply.
 *
 * The dispatcher (clientManager.js) MUST treat this router as the ONLY handler
 * for Food Safety production groups. There is no fallback.
 */

const { isFoodSafetyPilotGroup, getFoodSafetyPilotScope, getPhotoInstruction } = require("./foodSafetyPilotGuard");
const numericTextHandler = require("./numericTextHandler");
const db = require("./database");
const logger = require("./logger");
const { STORE_CONFIG } = require("./formImageRouter");
const storeKnowledge = require("./storeKnowledge");

// Lazy fallback session store. The numeric text handler requires a session
// provider to be wired in. foodSafetyHandler wires a real one on load; if
// the router is required standalone (tests, scripts) we provide a local
// in-memory store so the workflow stays functional.
const _standaloneSessions = {};
function _defaultSessionProvider(phoneNumber) {
    if (!_standaloneSessions[phoneNumber]) {
        _standaloneSessions[phoneNumber] = {
            language: "ES",
            pendingSubmission: null,
            pendingStoreConfirmation: null,
            waitingFor: null,
            lastImageHash: null,
        };
    }
    return _standaloneSessions[phoneNumber];
}
function _defaultMessageIdProvider(message) {
    return message && message.id && message.id._serialized
        ? message.id._serialized
        : String(message && message.id ? message.id : "");
}
numericTextHandler.setSessionProvider(_defaultSessionProvider);
numericTextHandler.setMessageIdProvider(_defaultMessageIdProvider);

function __setSessionProvider(fn) {
    numericTextHandler.setSessionProvider(fn || _defaultSessionProvider);
}
function __setMessageIdProvider(fn) {
    numericTextHandler.setMessageIdProvider(fn || _defaultMessageIdProvider);
}

/**
 * Workflow mode config (read once per call so tests can override).
 *   numeric               → production default
 *   legacy_image_disabled → same as numeric (audit reference)
 */
function getWorkflowMode() {
    const mode = String(process.env.FOOD_SAFETY_WORKFLOW_MODE || "numeric").toLowerCase().trim();
    return mode === "legacy_image_disabled" ? "legacy_image_disabled" : "numeric";
}

function legacyImageFlowEnabled() {
    return String(process.env.ENABLE_LEGACY_FOOD_SAFETY_IMAGE_FLOW || "false").toLowerCase().trim() === "true";
}

/**
 * Routes a Food Safety production message.
 * Returns:
 *   - string  → reply text to send to WhatsApp
 *   - null    → silent ignore (no reply)
 *
 * NEVER returns a Vision / OCR / form-review reply.
 */
async function handleFoodSafetyMessage(message, client) {
    const phone = message && message.from;
    const chatName = (message && (message._chatName || (message._data && message._data.chatName))) || "";

    const scope = getFoodSafetyPilotScope(message);
    if (!isFoodSafetyPilotGroup(scope)) {
        // Not a Food Safety production group — let other handlers run.
        return null;
    }

    const mode = getWorkflowMode();
    if (mode !== "numeric" && mode !== "legacy_image_disabled") {
        logger.warn("[NUMERIC_ROUTER] Unknown FOOD_SAFETY_WORKFLOW_MODE; defaulting to numeric", { mode });
    }

    db.logMessage(phone, "in", "[food safety inbound]", message.hasMedia ? "image" : "text");

    // ─── IMAGE: short instruction (once per user per shift) or silent ignore ───
    if (message && message.hasMedia && message.type === "image") {
        return await handleImage(message);
    }

    // ─── TEXT: numeric workflow ────────────────────────────────────────────────
    if (message && message.body && message.body.trim()) {
        return await handleText(message, client);
    }

    // Anything else in a Food Safety group: ignore silently.
    logger.info("[NUMERIC_ROUTER] Non-text/non-image message ignored", {
        phone, chatName, type: message && message.type,
    });
    return null;
}

async function handleImage(message) {
    const phone = message.from;
    const chatName = (message._chatName || (message._data && message._data.chatName)) || "";

    // Hard guard: if legacy flag is somehow enabled we still refuse, because
    // CEO directive requires OCR/Vision to be impossible for Food Safety groups.
    if (legacyImageFlowEnabled()) {
        logger.warn("[NUMERIC_ROUTER] ENABLE_LEGACY_FOOD_SAFETY_IMAGE_FLOW=true but refusing (CEO directive)", {
            phone, chatName,
        });
    }

    const instruction = getPhotoInstruction(phone);
    if (instruction) {
        db.logMessage(phone, "out", instruction, "text");
        logger.info("[NUMERIC_ROUTER] Sent short photo instruction (first in shift)", {
            phone, chatName,
        });
        return instruction;
    }

    // Silent ignore — preferred for Option C pilot
    logger.info("[NUMERIC_ROUTER] Photo silently ignored", { phone, chatName });
    return null;
}

function _buildChecklistFromScope(scope) {
    if (scope.role === "production_log" && scope.storeInfo) {
        return numericTextHandler.buildChecklist(scope.storeInfo);
    }
    if (scope.role === "logtest") {
        return numericTextHandler.buildChecklist({
            storeName: "Test Checklist (Stone Oak)",
            routingSource: "logtest",
        });
    }
    return null;
}

async function handleText(message, client) {
    const phone = message.from;
    const body = (message.body || "").trim();
    const upperBody = body.toUpperCase();

    // /agent → numeric checklist
    if (upperBody === "/AGENT") {
        const scope = getFoodSafetyPilotScope(message);
        const checklist = _buildChecklistFromScope(scope);
        if (checklist) {
            db.logMessage(phone, "out", checklist, "text");
            return checklist;
        }
        return null;
    }

    // numericTextHandler owns the rest:
    //   - numeric list (19 temperatures)
    //   - state machine for action replies (1/2/3/4 / CONFIRM / EDIT / RETAKE / CANCEL)
    // It already short-circuits non-Food-Safety groups and bare action digits.
    return await numericTextHandler.handleNumericTextMessage(message, client);
}

/**
 * Helper used by tests and the runtime proof endpoint.
 * Always returns the canonical, locked-down description.
 */
function getRouterLockdownProof() {
    return {
        router: "FoodSafetyNumericRouter",
        workflow_mode: getWorkflowMode(),
        legacy_image_flow_enabled: legacyImageFlowEnabled(),
        accepts: ["/agent", "numeric list", "1=Confirm", "2=Edit", "3=Re-enter", "4=Cancel", "EDIT <idx> <val>"],
        rejects: [
            "OCR (tesseract)",
            "PaddleOCR",
            "Gemini Flash Vision",
            "OpenAI / GPT-4o Vision",
            "Python vision_llm_bridge",
            "processSubmissionBatch",
            "python_vision_llm_pipeline",
            "This form needs review",
            "Detected items",
            "OCR confidence",
            "FoodSafety-StoneOak-v3",
            "FoodSafety-Rim-v3",
            "FoodSafety-Bandera-v3",
            "Selected column",
        ],
    };
}

module.exports = {
    handleFoodSafetyMessage,
    getRouterLockdownProof,
    getWorkflowMode,
    legacyImageFlowEnabled,
    __setSessionProvider,
    __setMessageIdProvider,
};
