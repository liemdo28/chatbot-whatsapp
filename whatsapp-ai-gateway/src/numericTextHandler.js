/**
 * numericTextHandler.js — CEO Directive Option C: Numeric Text Workflow Handler
 *
 * Handles the primary pilot workflow where employees send temperature readings
 * as a simple numeric text list in the WhatsApp group.
 *
 * Workflow:
 *   /agent → Bot shows store-specific checklist (B1/B2/B3 from group name)
 *   Employee sends number list → Bot validates → Employee confirms → Data saved
 *
 * Options after parse (CEO directive canonical mapping):
 *   1 = Confirm     → save to DB, sync Google Sheet
 *   2 = Edit        → allow EDIT command, refresh summary
 *   3 = Re-enter All → discard pending, prompt for fresh entry
 *   4 = Cancel      → discard pending, no DB/sheet write
 *
 * NO dependency on OCR, Vision LLM, OPENAI_API_KEY, or GEMINI_API_KEY.
 */

const { isNumericList, parseNumericList, mapValuesToFields, buildValidationSummary, EXPECTED_COUNT } = require("./numericTextParser");
const { STORE_CONFIG, getGroupScope } = require("./formImageRouter");
const storeKnowledge = require("./storeKnowledge");
const db = require("./database");
const gsheet = require("./googleSheet");
const logger = require("./logger");
const { STORE_TIMEZONE, getChicagoHourMinute, getBusinessDateChicago } = require("./submissionDueConfig");

// ─── Session State ───────────────────────────────────────────────────
let _getSharedSession = null;
let _getSharedMessageId = null;

function setSessionProvider(fn) {
    _getSharedSession = fn;
}

function setMessageIdProvider(fn) {
    _getSharedMessageId = fn;
}

// ─── Checklist Builder (STEP 1 & 2) ─────────────────────────────────

/**
 * Build the /agent checklist reply for a given store.
 * Format:
 *   Store: The Rim
 *   Please enter 19 temperatures in order:
 *   01 Walk-In Cooler (Produce)  30-45°F
 *   02 Walk-In Freezer  -20-5°F
 *   ...
 *   19 Pasta Boiler Right  200-220°F
 */
/**
 * Build the /agent command reply. Resolves the store from the group
 * and returns the store-specific checklist.
 */
function buildAgentReply(storeInfo) {
    return buildChecklist(storeInfo);
}

// ─── Simplified /agent response (P1 #4) ─────────────────────────────
// Kitchen employees already have the paper form. Keep this concise.
function buildChecklist(storeInfo) {
    const storeName = (storeInfo && storeInfo.storeName) ? storeInfo.storeName : "Store";
    return [
        `Food Safety Session Started`,
        ``,
        `Store: ${storeName}`,
        ``,
        `Please enter ${EXPECTED_COUNT} temperatures in the same order as the paper form.`,
        ``,
        `You can send:`,
        `\u2022 one value per line`,
        `\u2022 comma separated`,
        `\u2022 space separated`,
        ``,
        `Example:`,
        `40`,
        `10`,
        `40`,
        `150`,
        `32`,
        `...`,
        ``,
        `Reply after summary:`,
        `1 = Confirm`,
        `2 = Edit`,
        `3 = Re-enter`,
        `4 = Cancel`,
    ].join("\n");
}

// Optional: short item list (only shown if user sends "/agent list")
function buildChecklistWithItems(storeInfo) {
    const base = buildChecklist(storeInfo);
    const knowledge = storeKnowledge.getStoreKnowledge(storeInfo.storeCode);
    if (!knowledge || !Array.isArray(knowledge.fields)) return base;
    const lines = [base, "", "Items in order:"];
    for (const field of knowledge.fields) {
        const idx = String((field.field_id || "").split("-")[1] || "").padStart(2, "0");
        lines.push(`${idx} ${field.label}  ${field.range[0]}-${field.range[1]}\u00B0F`);
    }
    return lines.join("\n");
}

// ─── Reply Builders ──────────────────────────────────────────────────

/**
 * Build the confirmation summary reply for exactly 19 values.
 * Format (per CEO directive STEP 5):
 *   Store: The Rim
 *   19/19 values received
 *   Safe: 15
 *   Needs Review: 4
 *   Detected:
 *   01 Walk-In Cooler (Produce) = 40F
 *   ...
 *   19 Pasta Boiler Right = 210F
 *   Reply:
 *   1 = Confirm
 *   2 = Edit
 *   3 = Re-enter All
 *   4 = Cancel
 */
function buildConfirmSummary(storeName, validation) {
    const lines = [
        `Store: ${storeName}`,
        `${validation.total}/${EXPECTED_COUNT} values received`,
        `Safe: ${validation.safeCount}`,
        `Needs Review: ${validation.needsReviewCount}`,
        "",
        "Detected:",
    ];

    for (const item of validation.items) {
        const idx = String(item.index).padStart(2, "0");
        const value = item.detectedValue !== null && item.detectedValue !== undefined
            ? `${item.detectedValue}${item.unit}`
            : "N/A";
        lines.push(`${idx} ${item.label} = ${value}`);
    }

    lines.push("");
    lines.push("Reply:");
    lines.push("1 = Confirm");
    lines.push("2 = Edit");
    lines.push("3 = Re-enter All");
    lines.push("4 = Cancel");

    const unsafeItems = validation.items.filter(i => i.status === "UNSAFE");
    if (unsafeItems.length > 0) {
        lines.push("");
        lines.push("\u26A0\uFE0F Values outside safe range:");
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

function resolveStoreFromGroup(chatName, chatId) {
    const scope = getGroupScope({ chatId, chatName });
    if (scope.role === "production_log" && scope.storeInfo) {
        return { ...scope.storeInfo, routingSource: "production_group" };
    }
    const groupStore = require("./formImageRouter").detectStoreFromGroupName(chatName);
    if (groupStore) {
        return { ...groupStore, routingSource: "group_name" };
    }
    return null;
}

// ─── Duplicate Protection (STEP 10) ──────────────────────────────────

function submissionMatchesStore(sub, storeCode, storeName) {
    if (!sub) return false;

    const normalizedStoreCode = String(storeCode || "").trim().toUpperCase();
    const normalizedStoreName = String(storeName || "").trim().toLowerCase();
    const subStoreName = String(sub.store_name || "").trim().toLowerCase();

    if (normalizedStoreName && subStoreName === normalizedStoreName) {
        return true;
    }

    try {
        const ocrData = sub.ocr_json ? JSON.parse(sub.ocr_json) : {};
        if (normalizedStoreCode && String(ocrData.store_code || "").trim().toUpperCase() === normalizedStoreCode) {
            return true;
        }
        if (normalizedStoreName && String(ocrData.store_name || "").trim().toLowerCase() === normalizedStoreName) {
            return true;
        }
    } catch (_) {
        // Ignore malformed legacy payloads; store_name fallback already ran.
    }

    return false;
}

function supersedeExistingPending(phone, storeCode, storeName, newSubmissionId) {
    try {
        const pending = db.getSubmissions({ status: "PENDING", limit: 100 });
        for (const sub of pending) {
            if (sub.phone_number === phone && sub.status === "PENDING" && sub.id !== newSubmissionId) {
                if (submissionMatchesStore(sub, storeCode, storeName)) {
                    db.updateSubmissionStatus(sub.id, "SUPERSEDED");
                    logger.info("[NUMERIC_TEXT] Superseded prior pending submission", {
                        oldId: sub.id, newId: newSubmissionId, phone, storeCode, storeName,
                    });
                }
            }
        }
    } catch (err) {
        logger.warn("[NUMERIC_TEXT] supersedeExistingPending failed", { error: err.message });
    }
}

// ─── Core Handler ────────────────────────────────────────────────────

async function handleNumericTextMessage(message, client) {
    const phone = message.from;
    const body = (message.body || "").trim();
    const chatName = message._chatName || (message._data && message._data.chatName) || "";

    const session = _getSharedSession ? _getSharedSession(phone) : null;
    if (!session) return null;

    // ── STATE MACHINE PRIORITY 1: Handle pending action replies FIRST ──
    // If the session is waiting for a confirm/edit/re-enter/cancel action,
    // route ALL replies through the action handler. This MUST come before
    // any numeric list parsing so that "1" means Confirm (not a temperature).
    if (session.waitingFor === "numeric_action" && session.pendingSubmission) {
        const storeInfo = resolveStoreFromGroup(chatName, message.from);
        if (!storeInfo) {
            const origStoreCode = session.pendingSubmission.storeCode;
            const fallbackStore = STORE_CONFIG[origStoreCode] || STORE_CONFIG.B2;
            return handleNumericAction(body, session, phone, fallbackStore, message);
        }
        return handleNumericAction(body, session, phone, storeInfo, message);
    }

    // ── STATE MACHINE PRIORITY 1B: Bare action digit with no pending ──
    // If user types "1", "2", "3", or "4" without an active session,
    // treat as a helpful re-prompt — never as a numeric submission.
    if (/^[1-4]$/.test(body)) {
        const reply = "No active submission to confirm.\n\nType /agent to start a new Food Safety session, or send 19 temperature readings.";
        db.logMessage(phone, "in", body, "numeric_text");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    // ── STATE MACHINE PRIORITY 2: Parse numeric list ──
    if (!isNumericList(body)) {
        return null;
    }

    // Check group scope (must be a production group)
    const storeInfo = resolveStoreFromGroup(chatName, message.from);
    if (!storeInfo) {
        logger.info("[NUMERIC_TEXT] Non-production group, ignoring numeric list", { chatName, phone });
        return null;
    }

    // Parse the numeric list
    const values = parseNumericList(body);
    const prefix = storeInfo.fieldPrefix || storeInfo.storeCode;

    // Validate count — less than expected → SHORT OPERATIONAL MESSAGE
    if (values.length < EXPECTED_COUNT) {
        const reply =
            `Received ${values.length}/${EXPECTED_COUNT} values.\n\n` +
            "Please send all 19 values together, or type /agent to restart.\n\n" +
            "Example:\n40\n10\n40\n150\n32\n...";
        db.logMessage(phone, "in", body, "numeric_text");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    // Validate count — more than expected
    if (values.length > EXPECTED_COUNT) {
        const reply = buildExtraReply(values.length, values, prefix);
        db.logMessage(phone, "in", body, "numeric_text");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    // Exactly 19 values — map and validate
    const { items } = mapValuesToFields(values, storeInfo, storeKnowledge);
    const validation = buildValidationSummary(items);

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
        raw_values: JSON.stringify(values),
        mapped_values: JSON.stringify(items),
        validation_result: JSON.stringify({
            safeCount: validation.safeCount,
            needsReviewCount: validation.needsReviewCount,
            total: validation.total,
        }),
        editor_history: JSON.stringify([]),
    });

    // Duplicate protection: supersede any prior PENDING for same phone+store
    supersedeExistingPending(phone, storeInfo.storeCode, storeInfo.storeName, submissionId);

    session.pendingSubmission = {
        id: submissionId,
        parsed: {
            ocr_json: submissionJson,
            runtime_pipeline: "numeric_text_entry",
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

    const reply = buildConfirmSummary(storeInfo.storeName, validation);

    db.logMessage(phone, "in", body, "numeric_text");
    db.logMessage(phone, "out", reply, "text");
    return reply;
}

// ─── Action Handler (STEP 6-9) ──────────────────────────────────────

function handleNumericAction(body, session, phone, storeInfo, message) {
    const upperBody = body.toUpperCase().trim();
    const sub = session.pendingSubmission;
    if (!sub) return null;

    // 1 or CONFIRM — Save
    if (upperBody === "1" || upperBody === "CONFIRM") {
        try {
            // ── Shift Detection (CEO Directive) ──
            // Determine shift based on current time in America/Chicago.
            const nowChicago = getChicagoHourMinute();
            const shift = nowChicago.hour < 14 ? "10AM" : "4PM";
            const businessDate = getBusinessDateChicago();

            // Update ocr_json with shift info so the reminder engine can match
            try {
                const storedSubmission = db.getSubmission(sub.id);
                const existingOcrJsonRaw = (sub.parsed && sub.parsed.ocr_json)
                    || (storedSubmission && storedSubmission.ocr_json)
                    || "{}";
                const existingOcrJson = JSON.parse(existingOcrJsonRaw);
                existingOcrJson.shift = shift;
                existingOcrJson.business_date = businessDate;
                existingOcrJson.timezone = STORE_TIMEZONE;
                existingOcrJson.confirmed_at = new Date().toISOString();
                sub.parsed.ocr_json = JSON.stringify(existingOcrJson);
                db.run(
                    `UPDATE food_safety_submissions SET ocr_json = ? WHERE id = ?`,
                    [sub.parsed.ocr_json, sub.id]
                );
            } catch (jsonErr) {
                logger.warn("[NUMERIC_TEXT] Failed to update ocr_json with shift", { error: jsonErr.message });
            }

            db.updateSubmissionStatus(sub.id, "CONFIRMED");
            const now = new Date().toISOString();
            const reply = `\u2705 Record saved successfully.\n\nID: ${sub.id}\nStore: ${sub.storeName}\nDate: ${now}`;
            db.logMessage(phone, "out", reply, "text");

            // Sync Google Sheet (non-blocking, with retry queue on failure)
            gsheet.syncSubmission(sub.id, sub).then((sheetResult) => {
                if (sheetResult && sheetResult.status === "OK") {
                    db.markSheetSyncSuccess(sub.id);
                    return;
                }
                const reason = sheetResult && (sheetResult.error || sheetResult.message || sheetResult.status);
                db.enqueueSheetRetry(sub.id, reason || "Google Sheet sync did not complete");
            }).catch((sheetErr) => {
                logger.warn("[NUMERIC_TEXT] Google Sheet sync failed (queued for retry)", { error: sheetErr.message });
                db.enqueueSheetRetry(sub.id, sheetErr.message);
            });

            session.pendingSubmission = null;
            session.waitingFor = null;
            return reply;
        } catch (err) {
            logger.error("[NUMERIC_TEXT] CONFIRM save failed", { phone, error: err.message });
            return "\u274C Error saving the record. Please try again.";
        }
    }

    // 2 — Enter edit mode (show instructions + current summary)
    if (upperBody === "2") {
        const validation = buildValidationSummary(sub.parsed.items);
        const summary = buildConfirmSummary(sub.storeName, validation);
        const reply =
            "Enter edit command:\n" +
            "  EDIT {number} {value} - Example: EDIT 3 38\n" +
            "  EDIT {field_id} {value} - Example: EDIT SO-03 38\n\n" +
            "Reply:\n" +
            "  1 = Confirm\n" +
            "  3 = Re-enter All\n" +
            "  4 = Cancel\n\n" +
            "Current values:\n" +
            summary;
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    // 3 or RE-ENTER — Discard pending, prompt for fresh entry (no DB write)
    if (upperBody === "3" || upperBody === "RE-ENTER" || upperBody === "REENTER") {
        try {
            db.updateSubmissionStatus(sub.id, "CANCELLED");
            const reply =
                "\uD83D\uDD04 Pending record discarded. Please send the full list of " + EXPECTED_COUNT + " temperatures again.\n\n" +
                "Supported formats:\n" +
                "  one value per line\n" +
                "  comma separated\n" +
                "  space separated";
            db.logMessage(phone, "out", reply, "text");
            session.pendingSubmission = null;
            session.waitingFor = null;
            return reply;
        } catch (err) {
            logger.error("[NUMERIC_TEXT] RE-ENTER failed", { phone, error: err.message });
            return "\u274C Error discarding the record. Please try again.";
        }
    }

    // 4 or CANCEL — Discard pending (no DB write)
    if (upperBody === "4" || upperBody === "CANCEL") {
        try {
            db.updateSubmissionStatus(sub.id, "CANCELLED");
            const reply = "\u274C Record cancelled and discarded.";
            db.logMessage(phone, "out", reply, "text");
            session.pendingSubmission = null;
            session.waitingFor = null;
            return reply;
        } catch (err) {
            logger.error("[NUMERIC_TEXT] CANCEL failed", { phone, error: err.message });
            return "\u274C Error cancelling the record. Please try again.";
        }
    }

    // EDIT command (starts with "EDIT")
    if (upperBody.startsWith("EDIT")) {
        return handleEditCommand(body, session, phone, sub);
    }

    // RETAKE alias (backwards compat) — treat as 3/RE-ENTER
    if (upperBody === "RETAKE") {
        return handleNumericAction("3", session, phone, storeInfo, message);
    }

    // Invalid — re-prompt
    const reply = "Please reply:\n1 = Confirm\n2 = Edit\n3 = Re-enter All\n4 = Cancel";
    db.logMessage(phone, "out", reply, "text");
    return reply;
}

// ─── Edit Handler (STEP 7) ──────────────────────────────────────────

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

    // Refresh the full summary after edit so the user can review and confirm
    const validation = buildValidationSummary(sub.parsed.items);
    const refreshedSummary = buildConfirmSummary(sub.storeName, validation);

    const reply =
        `\u270F\uFE0F Edit applied: ${item.id} (${item.label}) updated from ${oldValue !== null ? `${oldValue}${item.unit}` : "N/A"} to ${newValue}${item.unit}\n\n` +
        refreshedSummary;
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
    buildChecklist,
    buildAgentReply,
};
