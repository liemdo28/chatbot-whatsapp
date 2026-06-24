/**
 * numericTextParser.js — CEO Directive Option C: Numeric Text List Parser
 *
 * Parses employee-submitted temperature readings sent as a simple number list
 * in the WhatsApp group. Supports flexible input formats:
 *   - One number per line
 *   - Comma-separated
 *   - Space-separated
 *   - Mixed commas/spaces/newlines
 *   - Dash "-" as blank/missing value
 *
 * Maps values by ORDER to store fields:
 *   Value 1 → {prefix}-01, Value 2 → {prefix}-02, ... Value 19 → {prefix}-19
 *
 * This module has ZERO dependency on OCR, Vision, or any external API key.
 */

const logger = require("./logger");

const EXPECTED_COUNT = 19;

// ─── Detection ───────────────────────────────────────────────────────

/**
 * Detect whether a text message is a numeric temperature list.
 * Returns true if the body is predominantly numbers with separators.
 *
 * Rules:
 *   - Must contain at least one number
 *   - After stripping separators (commas, spaces, newlines, dashes, minus signs),
 *     the remaining tokens should all be numeric
 *   - No more than 30 tokens (prevents huge free-text from triggering)
 */
function isNumericList(text) {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;

    // Remove common prefixes that might appear before the list
    const stripped = trimmed.replace(/^(TEMP|TEMPERATURE|TEMPS|VALUES?|READING|LOG)\s*[:\-=]?\s*/i, "").trim();

    // Split by common separators: comma, space, newline, tab
    // Also handle dashes used as blank markers
    const tokens = stripped.split(/[\s,;\n\r\t|]+/).filter(t => t.length > 0);

    if (tokens.length === 0 || tokens.length > 30) return false;

    // Check each token is either a valid number or a dash (blank marker)
    let hasNumber = false;
    for (const token of tokens) {
        // Allow: digits, optional leading minus, optional decimal
        // Also allow bare "-" or "--" as blank marker
        if (/^-{1,3}$/.test(token)) {
            // Pure dash = blank, OK
            continue;
        }
        if (/^-?\d+(\.\d+)?$/.test(token)) {
            hasNumber = true;
            continue;
        }
        // If any token is non-numeric and non-dash, it's not a numeric list
        return false;
    }

    return hasNumber;
}

// ─── Parsing ─────────────────────────────────────────────────────────

/**
 * Parse a numeric text list into an array of values or nulls.
 *
 * Input formats accepted:
 *   "40\n10\n40\n150\n32"
 *   "40, 10, 40, 150, 32"
 *   "40 10 40 150 32"
 *   "40,10,40,150,32"
 *   Mixed: "40 10, 40\n150 32"
 *   Dash blank: "40 - 40 150 32" → [40, null, 40, 150, 32]
 *
 * @param {string} text - Raw text input from WhatsApp message
 * @returns {Array<number|null>} Array of parsed values (null = blank/missing)
 */
function parseNumericList(text) {
    if (!text || typeof text !== "string") return [];

    const trimmed = text.trim();

    // Strip optional prefixes like "TEMP:", "VALUES:", etc.
    const stripped = trimmed.replace(/^(TEMP|TEMPERATURE|TEMPS|VALUES?|READING|LOG)\s*[:\-=]?\s*/i, "").trim();

    // Split by all separators: commas, spaces, newlines, tabs, pipes, semicolons
    const tokens = stripped.split(/[\s,;\n\r\t|]+/).filter(t => t.length > 0);

    const values = [];
    for (const token of tokens) {
        // Pure dash(s) = blank/missing
        if (/^-{1,3}$/.test(token)) {
            values.push(null);
            continue;
        }

        const n = Number(token);
        if (Number.isFinite(n)) {
            values.push(n);
        }
        // Non-numeric, non-dash tokens are skipped (shouldn't happen if isNumericList passed)
    }

    return values;
}

// ─── Field Mapping ───────────────────────────────────────────────────

/**
 * Map parsed values to field objects using store knowledge.
 *
 * @param {Array<number|null>} values - Parsed value array
 * @param {object} storeInfo - Store config from formImageRouter (storeCode, fieldPrefix, etc.)
 * @param {object} storeKnowledgeModule - The storeKnowledge module (for getFieldKnowledge)
 * @returns {object} { items: [...], missingIndices: [...], extraCount: number }
 */
function mapValuesToFields(values, storeInfo, storeKnowledgeModule) {
    const prefix = storeInfo.fieldPrefix || storeInfo.storeCode;
    const storeCode = storeInfo.storeCode;
    const fields = [];

    for (let i = 0; i < EXPECTED_COUNT; i++) {
        const index = i + 1;
        const fieldId = `${prefix}-${String(index).padStart(2, "0")}`;
        const fieldKnowledge = storeKnowledgeModule.getFieldKnowledge(storeCode, fieldId);

        const range = fieldKnowledge
            ? { min: fieldKnowledge.range[0], max: fieldKnowledge.range[1] }
            : { min: -40, max: 450 };

        const value = i < values.length ? values[i] : null;

        let status;
        if (value === null || value === undefined) {
            status = "MISSING";
        } else if (value >= range.min && value <= range.max) {
            status = "SAFE";
        } else {
            status = "UNSAFE";
        }

        fields.push({
            index,
            id: fieldId,
            field_id: fieldId,
            label: fieldKnowledge ? fieldKnowledge.label : fieldId,
            item: fieldKnowledge ? fieldKnowledge.label : fieldId,
            detectedValue: value,
            value,
            unit: "F",
            safeRange: range,
            range_min: range.min,
            range_max: range.max,
            confidence: value !== null ? 1 : 0,
            isSafe: status === "SAFE",
            status,
            _predictionSource: "NUMERIC_TEXT_ENTRY",
            _predictionConfidence: value !== null ? 1 : 0,
            _needsConfirmation: false,
        });
    }

    const missingIndices = [];
    for (let i = 0; i < Math.min(values.length, EXPECTED_COUNT); i++) {
        if (values[i] === null) {
            missingIndices.push(i + 1);
        }
    }
    // Missing beyond what was submitted
    for (let i = values.length; i < EXPECTED_COUNT; i++) {
        missingIndices.push(i + 1);
    }

    const extraCount = Math.max(0, values.length - EXPECTED_COUNT);

    return { items: fields, missingIndices, extraCount };
}

// ─── Validation Summary ──────────────────────────────────────────────

/**
 * Build validation result for exactly 19 values.
 *
 * @param {Array<object>} items - Mapped field items
 * @returns {object} { safeCount, needsReviewCount, items }
 */
function buildValidationSummary(items) {
    let safeCount = 0;
    let needsReviewCount = 0;

    for (const item of items) {
        if (item.status === "SAFE") {
            safeCount++;
        } else {
            // UNSAFE and MISSING both count as "Needs Review"
            needsReviewCount++;
        }
    }

    return {
        safeCount,
        needsReviewCount,
        total: items.length,
        items,
    };
}

module.exports = {
    EXPECTED_COUNT,
    isNumericList,
    parseNumericList,
    mapValuesToFields,
    buildValidationSummary,
};
