/**
 * numericTextHandler.js — CEO Directive Option C: Numeric Text Workflow Handler
 *
 * Handles the primary pilot workflow where employees send temperature readings
 * as a simple numeric text list in the WhatsApp group.
 *
 * Workflow:
 *   Employee sends number list → Bot validates → Employee confirms → Data saved
 *
 * NO dependency on OCR, Vision LLM, OPENAI_API_KEY, or GEMINI_API_KEY.
 */

const { isNumericList, parseNumericList, mapValuesToFields, buildValidationSummary, EXPECTED_COUNT } = require("./numericTextParser");
const { STORE_CONFIG, getGroupScope, resolveStoreFromContext } = require("./formImageRouter");
const storeKnowledge = require("./storeKnowledge");
const db = require("./database");
const gsheet = require("./googleSheet");
const logger = require("./logger");

// ─── Session State ───────────────────────────────────────────────────
// We share sessions from foodSafetyHandler via a setter pattern to avoid circular deps.
let _getSharedSession = null;
let _getSharedMessageId = null;

function setSessionProvider(fn) {
    _getSharedSession = fn;
}

function setMessageIdProvider(fn) {
    _getSharedMessageId = fn;
}

// ─── Reply Builders ──────────────────────────────────────────────────

/**
 * Build the confirmation summary reply for exactly 19 values.
 *
 * Format:
 *   Store: The Rim
 *   19/19 values received
 *   Safe: 15
 *   Needs Review: 4
 *
 *   Reply:
 *   1 = Confirm
 *   2 = Edit
 *   3 = Cancel
 */
function buildConfirmSummary(storeName, validation) {
    const lines = [
        `Store: ${storeName}`,
        `${validation.total}/${EXPECTED_COUNT} values received`,
        `Safe: ${validation.safeCount}`,
        `Needs Review: ${validation.needsReviewCount}`,
        "",
        "Reply:",
        "1 = Confirm",
        "2 = Edit",
        "3 = Cancel",
    ];

    // List UNSAFE items for quick review
    const unsafeItems = validation.items.filter(i => i.status === "UNSAFE");
    if (unsafeItems.length > 0) {
        lines.push("");
        lines.push("⚠️ Values outside safe range:");
        for (const item of unsafeItems) {
            lines.push(`  ${item.id} (${item.label}): ${item.detectedValue}${item.unit} [${item.safeRange.min}-${item.safeRange.max}]`);
        }
    }

    return lines.join("\n");
}

/**
 * Build the "missing values" reply when fewer than 19 values received.
 */
function buildMissingReply(count, missingIndices, prefix) {
    const lines = [
        `Received ${count}/${EXPECTED_COUNT} values.`,
        "",
        "Missing:",
        ...missingIndices.map(i => `${prefix}-${String(i).padStart(2, "0")}`),
        "",
        "Please send the missing values or resend the full list.",
    ];
    return lines.join("\n");
}

/**
 * Build the "extra values" reply when more than 19 values received.
 */
function buildExtraReply(count, values, prefix) {
    const lines = [
        `Received ${count} values.`,
        `Expected ${EXPECTED_COUNT}.`,
        "",
        "Extra values:",
    ];
    for (let i = EXPECTED_COUNT; i < count; i++) {
        lines.push(`${i + 1} = ${values[i]}`);
    }
    lines.push("");
    lines.push("Please resend the corrected list.");
    return lines.join("\n");
}

// ─── Store Resolution ────────────────────────────────────────────────

/**
 * Resolve store from the WhatsApp group context.
 * For numeric text workflow, store is determined SOLELY by the group name/ID.
 * No OCR, no header detection, no vision.
 */
function resolveStoreFromGroup(chatName, chatId) {
    const scope = getGroupScope({ chatId, chatName });

    if (scope.role === "production_log" && scope.storeInfo) {
        return { ...scope.storeInfo, routingSource: "production_group" };
    }

    // Fallback: try group name detection
    const groupStore = require("./formImageRouter").detectStoreFromGroupName(chatName);
    if (groupStore) {
        return { ...groupStore, routingSource: "group_name" };
    }

    return null;
}

// ─── Core Handler ────────────────────────────────────────────────────

/**
 * Try to handle a text message as a numeric temperature list.
 *
 * @param {object} message - WhatsApp message object
 * @param {object} client - WhatsApp client (unused in text path, kept for API compat)
 * @returns {string|null} Reply text, or null if not handled by numeric text flow
 */
async function handleNumericTextMessage(message, client) {
    const phone = message.from;
    const body = (message.body || "").trim();
    const chatName = message._chatName || (message._data && message._data.chatName) || "";

    // Get session from shared provider
    const session = _getSharedSession ? _getSharedSession(phone) : null;
    if (!session) return null;

    // ── STEP 1: Handle pending action replies FIRST ──
    // When waiting for numeric_action, handle 1/2/3/CONFIRM/EDIT/CANCEL
    // BEFORE checking isNumericList — these are text commands, not numbers.
    if (session.waitingFor === "numeric_action" && session.pendingSubmission) {
        const storeInfo = resolveStoreFromGroup(chatName, message.from);
        if (!storeInfo) {
            // Fallback: use the store from the original submission
            const origStoreCode = session.pendingSubmission.storeCode;
            const fallbackStore = STORE_CONFIG[origStoreCode] || STORE_CONFIG.B2;
            return handleNumericAction(body, session, phone, fallbackStore, message);
        }
        return handleNumericAction(body, session, phone, storeInfo, message);
    }

    // ── STEP 2: Check if this is a numeric list ──
    if (!isNumericList(body)) {
        return null; // Not a numeric list — let other handlers try
    }

    // ── STEP 3: Check group scope (must be a production group) ──
    const storeInfo = resolveStoreFromGroup(chatName, message.from);
    if (!storeInfo) {
        // Not in a recognized production group — ignore numeric lists silently
        logger.info("[NUMERIC_TEXT] Non-production group, ignoring numeric list", {
            chatName,
            phone,
        });
        return null;
    }

    // ── STEP 4: Parse the numeric list ──
    const values = parseNumericList(body);
    const prefix = storeInfo.fieldPrefix || storeInfo.storeCode;

    // ── STEP 5: Validate count ──
    if (values.length > EXPECTED_COUNT) {
        // Extra values
        const reply = buildExtraReply(values.length, values, prefix);
        db.logMessage(phone, "in", body, "numeric_text");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    if (values.length < EXPECTED_COUNT) {
        // Missing values
        const missingIndices = [];
        for (let i = 0; i < values.length; i++) {
            if (values[i] === null) missingIndices.push(i + 1);
        }
        for (let i = values.length; i < EXPECTED_COUNT; i++) {
            missingIndices.push(i + 1);
        }
        const reply = buildMissingReply(values.length, missingIndices, prefix);
        db.logMessage(phone, "in", body, "numeric_text");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    // ── STEP 6: Exactly 19 values — map and validate ──
    const { items, missingIndices } = mapValuesToFields(values, storeInfo, storeKnowledge);
    const validation = buildValidationSummary(items);

    // Build submission record
    const submissionJson = JSON.stringify({
        runtime_pipeline: "numeric_text_entry",
        ocr_provider: "none",
        vision_provider: "none",
        source: "numeric_text",
        store_code: storeInfo.storeCode,
        values,
    });

    const submissionId = db.insertSubmission({
        store_name: storeInfo.storeName,
        phone_number: phone,
        employee_name: null,
        message_id: _getSharedMessageId ? _getSharedMessageId(message) : "",
        trace_id: null,
        image_path: null,
        ocr_raw_text: body,
        ocr_json: submissionJson,
        ocr_confidence: 100,
        detected_items: JSON.stringify(items),
        status: "PENDING",
        language: session.language || "ES",
    });

    session.pendingSubmission = {
        id: submissionId,
        parsed: {
            store_id: storeInfo.storeCode,
            storeName: storeInfo.storeName,
            store_name: storeInfo.storeName,
            template_id: storeInfo.templateId,
            isForm: true,
            classification: "NUMERIC_TEXT_ENTRY",
            items,
            issues: items.filter(i => i.status !== "SAFE").map(i => ({
                type: i.status === "UNSAFE" ? "UNSAFE_TEMP" : "MISSING_FIELD",
                item: i.label,
                id: i.id,
                detected: `${i.detectedValue}${i.unit}`,
                range: `${i.safeRange.min}-${i.safeRange.max}`,
                index: i.index,
            })),
            confidence: 100,
            selected_column: null,
        },
        rawText: body,
        storeName: storeInfo.storeName,
        storeCode: storeInfo.storeCode,
    };
    session.waitingFor = "numeric_action";

    // Build reply
    const reply = buildConfirmSummary(storeInfo.storeName, validation);

    db.logMessage(phone, "in", body, "numeric_text");
    db.logMessage(phone, "out", reply, "text");
    return reply;
}

/**
 * Handle action replies during the numeric text confirmation flow.
 *
 * Accepted:
 *   1 = Confirm → save to DB, sync Google Sheet
 *   2 = Edit → allow EDIT command
 *   3 or CANCEL → discard pending submission
 */
function handleNumericAction(body, session, phone, storeInfo, message) {
    const upperBody = body.toUpperCase().trim();
    const sub = session.pendingSubmission;
    if (!sub) return null;

    // Reply "1" or "CONFIRM" — Save
    if (upperBody === "1" || upperBody === "CONFIRM") {
        try {
            db.updateSubmissionStatus(sub.id, "CONFIRMED");
            const now = new Date().toISOString();
            const reply = `✅ Record saved successfully.\n\nID: ${sub.id}\nStore: ${sub.storeName}\nDate: ${now}`;
            db.logMessage(phone, "out", reply, "text");

            // Sync Google Sheet (non-blocking)
            gsheet.syncSubmission(sub.id, sub).catch((sheetErr) => {
                logger.warn("[NUMERIC_TEXT] Google Sheet sync failed (non-blocking)", { error: sheetErr.message });
            });

            session.pendingSubmission = null;
            session.waitingFor = null;
            return reply;
        } catch (err) {
            logger.error("[NUMERIC_TEXT] CONFIRM save failed", { phone, error: err.message });
            return "❌ Error saving the record. Please try again.";
        }
    }

    // Reply "2" or starts with "EDIT" — Edit mode
    if (upperBody === "2" || upperBody === "EDIT") {
        if (upperBody === "2") {
            const reply = "Enter edit command:\nEDIT {number} {value}\nExample: EDIT 3 38\n\nOr EDIT {field_id} {value}\nExample: EDIT SO-03 38\n\nReply CANCEL to discard.";
            db.logMessage(phone, "out", reply, "text");
            return reply;
        }
        // Handle actual EDIT command
        return handleEditCommand(body, session, phone, sub);
    }

    // If already in edit mode, check for EDIT command
    if (upperBody.startsWith("EDIT")) {
        return handleEditCommand(body, session, phone, sub);
    }

    // Reply "3" or "CANCEL" — Discard
    if (upperBody === "3" || upperBody === "CANCEL") {
        try {
            db.updateSubmissionStatus(sub.id, "CANCELLED");
            const reply = "❌ Record discarded.";
            db.logMessage(phone, "out", reply, "text");
            session.pendingSubmission = null;
            session.waitingFor = null;
            return reply;
        } catch (err) {
            logger.error("[NUMERIC_TEXT] CANCEL failed", { phone, error: err.message });
            return "❌ Error cancelling the record. Please try again.";
        }
    }

    // Invalid — re-prompt
    const reply = "Please reply:\n1 = Confirm\n2 = Edit\n3 = Cancel";
    db.logMessage(phone, "out", reply, "text");
    return reply;
}

/**
 * Handle an EDIT command within the numeric text confirmation flow.
 * Supports:
 *   EDIT 3 38       → edit field at index 3
 *   EDIT SO-03 38   → edit field SO-03
 *   EDIT RIM-03 38  → edit field RIM-03
 */
function handleEditCommand(body, session, phone, sub) {
    const parts = body.substring(4).trim().split(/\s+/);
    if (parts.length < 2) {
        const reply = "Format: EDIT {number} {value} or EDIT {field_id} {value}\nExample: EDIT 3 38";
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    const indexOrId = parts[0];
    const newValue = parseFloat(parts[1]);
    if (isNaN(newValue)) {
        const reply = "Invalid value. Use: EDIT 3 38";
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    let itemIndex = -1;
    const numIndex = parseInt(indexOrId);
    if (!isNaN(numIndex) && numIndex >= 1 && numIndex <= sub.parsed.items.length) {
        itemIndex = numIndex - 1;
    } else {
        itemIndex = sub.parsed.items.findIndex(
            (it) => it.id.toUpperCase() === indexOrId.toUpperCase()
        );
    }

    if (itemIndex < 0) {
        const reply = `Field "${indexOrId}" not found.`;
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    const item = sub.parsed.items[itemIndex];
    const oldValue = item.detectedValue;
    item.detectedValue = newValue;
    item.value = newValue;
    item.status = newValue >= item.safeRange.min && newValue <= item.safeRange.max ? "SAFE" : "UNSAFE";
    item.isSafe = item.status === "SAFE";

    db.insertEdit({
        submission_id: sub.id,
        edit_command: body,
        field_index: itemIndex + 1,
        old_value: oldValue !== null ? String(oldValue) : "null",
        new_value: String(newValue),
    });

    // Rebuild issues
    sub.parsed.issues = sub.parsed.items.filter(i => i.status !== "SAFE").map(i => ({
        type: i.status === "UNSAFE" ? "UNSAFE_TEMP" : "MISSING_FIELD",
        item: i.label,
        id: i.id,
        detected: `${i.detectedValue}${i.unit}`,
        range: `${i.safeRange.min}-${i.safeRange.max}`,
        index: i.index,
    }));

    // Update detected_items in DB
    db.updateSubmissionOcr(sub.id, {
        store_name: sub.storeName,
        ocr_raw_text: sub.rawText,
        ocr_json: sub.parsed.ocr_json || sub.rawText,
        ocr_confidence: 100,
        detected_items: JSON.stringify(sub.parsed.items),
        status: "PENDING",
    });

    const reply = `✏️ Edit applied: ${item.id} (${item.label}) updated from ${oldValue !== null ? `${oldValue}${item.unit}` : "N/A"} to ${newValue}${item.unit}`;
    db.logMessage(phone, "out", reply, "text");
    return reply;
}

module.exports = {
    handleNumericTextMessage,
    isNumericList,
    buildConfirmSummary,
    buildMissingReply,
    buildExtraReply,
    resolveStoreFromGroup,
    setSessionProvider,
    setMessageIdProvider,
    handleNumericAction,
    handleEditCommand,
};
