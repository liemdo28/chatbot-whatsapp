/**
 * zeroRetakeReplyBuilder.js — Phase 5: Smart Confirmation Flow
 *
 * NEW FLOW (CEO Directive):
 *   RETAKE is the LAST option, never the first.
 *
 * Instead of: "Low confidence. RETAKE."
 * Send:       "Store detected. Most values confident. Only 2 fields need confirmation:
 *              SO-16 = 360 ?  SO-17 = 350 ?  Reply CONFIRM or EDIT SO-16 355"
 *
 * Rules:
 *   - Never reject the whole form for 1-2 uncertain fields
 *   - Show all confident fields silently
 *   - Only ask about uncertain/predicted fields
 *   - Give EDIT shortcut for each uncertain field
 *   - RETAKE only if >40% fields uncertain OR form not visible
 */

const logger = require("./logger");

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * Classify field confidence levels.
 * Returns "CONFIDENT", "PREDICTED", "UNCERTAIN", or "MISSING".
 */
function classifyField(item) {
    if (item.detectedValue === null || item.detectedValue === undefined) {
        return "MISSING";
    }
    const source = item._predictionSource || "";
    const needsConfirm = item._needsConfirmation === true;
    const conf = toNumber(item._predictionConfidence || item.confidence);

    if (source === "MANUAL_ENTRY" || source === "EDIT") return "CONFIDENT";
    if (source === "OCR_HIGH_CONFIDENCE" && !needsConfirm) return "CONFIDENT";
    if (source === "OCR_WITH_MEMORY_SUPPORT" && !needsConfirm) return "CONFIDENT";
    if (source === "CONFIRMED_BY_MEMORY") return "CONFIDENT";
    if (source === "MEMORY_ASSISTED" || source === "RANGE_CORRECTED") return "PREDICTED";
    if (source === "HUMAN_REQUIRED") return "UNCERTAIN";
    if (needsConfirm && conf !== null && conf >= 0.8) return "PREDICTED";
    if (needsConfirm) return "UNCERTAIN";
    if (conf !== null && conf >= 0.85) return "CONFIDENT";
    if (conf !== null && conf >= 0.6) return "PREDICTED";
    return "UNCERTAIN";
}

function fieldDisplay(item) {
    const fieldId = item.field_id || item.id;
    const label = item.label || item.item || "";
    return label ? `${fieldId} ${label}` : fieldId;
}

/**
 * Build the smart confirmation message.
 *
 * @param {Object} opts
 * @param {Array} opts.items - Form items with predictions
 * @param {Object} opts.storeInfo - { storeName, storeCode, fieldPrefix, templateId }
 * @param {string} opts.selectedColumn - "10:00" or "16:00"
 * @param {string} opts.language - "ES" or "EN"
 * @param {boolean} opts.memoryUsed - Whether memory was used
 * @param {boolean} opts.writerProfileUsed - Whether writer profile was used
 * @param {boolean} opts.crossFieldDetected - Whether cross-field correction happened
 * @param {number} opts.ocrConfidence - Overall OCR confidence
 * @param {Object} opts.predictionResult - Full prediction result
 * @returns {Object} { message, confidentCount, predictedCount, uncertainCount, missingCount, needsRetake }
 */
function buildSmartConfirmationMessage(opts) {
    const {
        items = [],
        storeInfo = {},
        selectedColumn,
        language = "ES",
        memoryUsed = false,
        writerProfileUsed = false,
        crossFieldDetected = false,
        ocrConfidence = 0,
        predictionResult,
    } = opts;

    const isES = language !== "EN";
    const fieldPrefix = storeInfo.fieldPrefix || "SO";
    const storeName = storeInfo.storeName || "Unknown";
    const storeCode = storeInfo.storeCode || "??";

    // Classify all fields
    const classified = items.map((item, idx) => ({
        item,
        index: idx,
        classification: classifyField(item),
    }));

    const confident = classified.filter(c => c.classification === "CONFIDENT");
    const predicted = classified.filter(c => c.classification === "PREDICTED");
    const uncertain = classified.filter(c => c.classification === "UNCERTAIN");
    const missing = classified.filter(c => c.classification === "MISSING");

    // Determine column label
    let columnLabel = "N/A";
    if (selectedColumn === "10:00") columnLabel = "10AM";
    else if (selectedColumn === "16:00") columnLabel = "4PM";
    else if (selectedColumn) columnLabel = selectedColumn;

    const totalFields = items.length;
    const uncertainPct = totalFields > 0 ? (uncertain.length + missing.length) / totalFields : 1;

    // RETAKE ONLY if >40% of fields are uncertain/missing
    const needsRetake = uncertainPct > 0.4;

    const lines = [];

    lines.push("Food Safety numeric submission review.");
    lines.push("");
    lines.push(`Store: ${storeName} / ${storeCode}`);
    lines.push(`Template: ${storeInfo.templateId || "N/A"}`);
    lines.push(`Column: ${columnLabel}`);
    lines.push("");

    // Status summary
    const statusParts = [];
    statusParts.push(`${confident.length}/${totalFields} confident`);
    if (predicted.length > 0) statusParts.push(`${predicted.length} predicted`);
    if (uncertain.length > 0) statusParts.push(`${uncertain.length} need confirmation`);
    if (missing.length > 0) statusParts.push(`${missing.length} missing`);
    lines.push(isES ? `Estado: ${statusParts.join(", ")}` : `Status: ${statusParts.join(", ")}`);
    lines.push("");

    // If confident fields exist, show a brief summary (not every field)
    if (confident.length > 0) {
        lines.push(isES ? "Valores confirmados:" : "Confirmed values:");
        for (const c of confident) {
            const item = c.item;
            const val = item.detectedValue !== null ? `${item.detectedValue}${item.unit || "F"}` : "N/A";
            lines.push(`  ${fieldDisplay(item)}: ${val}`);
        }
        lines.push("");
    }

    // Predicted fields — show with tag
    if (predicted.length > 0) {
        lines.push(isES ? "Valores predichos (necesitan confirmación):" : "Predicted values (need confirmation):");
        for (const p of predicted) {
            const item = p.item;
            const val = item.detectedValue !== null ? `${item.detectedValue}${item.unit || "F"}` : "N/A";
            const source = item._predictionSource || "";
            let tag = "PREDICTED";
            if (source === "MEMORY_ASSISTED") tag = "MEMORY";
            else if (source === "RANGE_CORRECTED") tag = "CORRECTED";
            lines.push(`  ${fieldDisplay(item)}: ${val} (${tag})`);
        }
        lines.push("");
    }

    // Uncertain fields — these need user attention
    if (uncertain.length > 0) {
        lines.push(isES ? "Necesitan confirmación:" : "Need confirmation:");
        for (const u of uncertain) {
            const item = u.item;
            const val = item.detectedValue !== null ? `${item.detectedValue}${item.unit || "F"}` : "N/A";
            lines.push(`  ${fieldDisplay(item)} = ${val} ?`);
        }
        lines.push("");
    }

    // Missing fields
    if (missing.length > 0) {
        lines.push(isES ? "Campos no detectados:" : "Missing fields:");
        for (const m of missing) {
            lines.push(`  ${fieldDisplay(m.item)}`);
        }
        lines.push("");
    }

    // Reply instructions
    lines.push(isES ? "Responde:" : "Reply:");

    if (uncertain.length === 0 && missing.length === 0) {
        // All fields confident — simple confirm
        lines.push("CONFIRM = save");
    } else {
        lines.push("CONFIRM = save with current values");
        // Show edit shortcuts for uncertain/missing fields
        for (const u of [...uncertain, ...missing]) {
            const fieldId = u.item.field_id || u.item.id;
            lines.push(`EDIT ${fieldId} <value> = correct this field`);
        }
    }

    if (needsRetake) {
        lines.push("3 = re-enter all values");
    }
    lines.push("MANUAL = enter all values");
    lines.push("MANAGER = send to manager");
    lines.push("CANCEL = discard");

    if (needsRetake) {
        lines.push("");
        if (isES) {
            lines.push("Too many fields need review. Please type /agent and enter the 19 temperature readings.");
        } else {
            lines.push("Too many fields need review. Please type /agent and enter the 19 temperature readings.");
        }
    }

    const message = lines.join("\n");

    return {
        message,
        confidentCount: confident.length,
        predictedCount: predicted.length,
        uncertainCount: uncertain.length,
        missingCount: missing.length,
        needsRetake,
        uncertainPct: Math.round(uncertainPct * 100),
        hasPredicted: predicted.length > 0,
        hasUncertain: uncertain.length > 0,
        hasMissing: missing.length > 0,
        totalFields,
    };
}

/**
 * Build a minimal, non-redundant confirmation for mostly-confident forms.
 * Used when all fields are confident or predicted with high confidence.
 * Shows only the "Need confirmation" section.
 */
function buildMinimalConfirmation(opts) {
    const {
        items = [],
        storeInfo = {},
        selectedColumn,
        language = "ES",
    } = opts;

    const isES = language !== "EN";
    const storeName = storeInfo.storeName || "Unknown";
    const storeCode = storeInfo.storeCode || "??";

    let columnLabel = "N/A";
    if (selectedColumn === "10:00") columnLabel = "10AM";
    else if (selectedColumn === "16:00") columnLabel = "4PM";

    const uncertain = items.filter(item => classifyField(item) !== "CONFIDENT");

    const lines = [
        isES ? "Formulario detectado." : "Form detected.",
        `Store: ${storeName} / ${storeCode}  |  Column: ${columnLabel}`,
        "",
    ];

    if (uncertain.length === 0) {
        // All confident — show brief summary
        lines.push(isES ? "Todos los valores OK:" : "All values OK:");
        for (const item of items) {
            const val = item.detectedValue !== null ? `${item.detectedValue}${item.unit || "F"}` : "N/A";
            lines.push(`  ${fieldDisplay(item)}: ${val}`);
        }
        lines.push("");
        lines.push(isES ? "Responde CONFIRM para guardar." : "Reply CONFIRM to save.");
    } else {
        lines.push(isES ? "Solo necesitas confirmar:" : "Just confirm these:");
        for (const item of uncertain) {
            const val = item.detectedValue !== null ? `${item.detectedValue}${item.unit || "F"}` : "?";
            lines.push(`  ${fieldDisplay(item)} = ${val} ?`);
        }
        lines.push("");
        lines.push("CONFIRM = save  |  EDIT <field> <value> = correct");
    }

    return lines.join("\n");
}

/**
 * Get field-level confidence summary for capture rate tracking.
 */
function getFieldConfidenceSummary(items) {
    let confident = 0, predicted = 0, uncertain = 0, missing = 0;
    for (const item of items) {
        const cls = classifyField(item);
        if (cls === "CONFIDENT") confident++;
        else if (cls === "PREDICTED") predicted++;
        else if (cls === "UNCERTAIN") uncertain++;
        else missing++;
    }
    return { confident, predicted, uncertain, missing, total: items.length };
}

module.exports = {
    buildSmartConfirmationMessage,
    buildMinimalConfirmation,
    classifyField,
    fieldDisplay,
    getFieldConfidenceSummary,
};
