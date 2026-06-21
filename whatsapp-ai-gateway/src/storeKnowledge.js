/**
 * storeKnowledge.js — Phase 4: Store Knowledge Layer
 *
 * Store-specific rules for each field:
 *   - Expected temperature range
 *   - Criticality (critical fields require vision review when uncertain)
 *   - Typical values (historical modes)
 *   - Common bad OCR values (known misreads)
 *   - Whether field requires vision review on conflict
 */

const logger = require("./logger");

// ─── Helper: Build field definitions from formTemplates.json ────────

function buildFieldEntry(id, label, rangeMin, rangeMax, opts = {}) {
    return {
        field_id: id,
        label,
        range: [rangeMin, rangeMax],
        criticality: opts.criticality || "normal",
        typical_values: opts.typical_values || [],
        common_bad_ocr_values: opts.common_bad_ocr_values || [],
        requires_vision_review: opts.requires_vision_review || false,
    };
}

// ─── Store Field Knowledge Base ──────────────────────────────────────

const STORE_KNOWLEDGE = {
    B1: {
        storeCode: "B1",
        storeName: "The Rim",
        fieldPrefix: "RIM",
        fields: [
            buildFieldEntry("RIM-01", "Walk-In Cooler (Produce)", 30, 45, {
                typical_values: [33, 34, 35, 36, 37, 38],
                common_bad_ocr_values: [1, 7, 138],
            }),
            buildFieldEntry("RIM-02", "Walk-In Freezer", -20, 5, {
                typical_values: [-5, -2, 0, 1, 2, -10],
                common_bad_ocr_values: [200, 300, 400],
            }),
            buildFieldEntry("RIM-03", "Prep Area Cooler", 30, 45, {
                typical_values: [33, 34, 35, 36, 37],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("RIM-04", "Bowl Warmer", 100, 125, {
                typical_values: [105, 108, 110, 112, 115],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("RIM-05", "Ramen Reach-In Top", 30, 45, {
                typical_values: [33, 34, 35, 36, 37],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("RIM-06", "Ramen Reach-In Below", 30, 45, {
                typical_values: [33, 34, 35, 36, 37],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("RIM-07", "Line Freezer", -20, 0, {
                typical_values: [-5, -2, -8, -10, 0],
                common_bad_ocr_values: [200, 300],
            }),
            buildFieldEntry("RIM-08", "Seasoned Eggs", 95, 105, {
                criticality: "critical",
                typical_values: [97, 98, 100, 101, 102],
                common_bad_ocr_values: [1, 7, 18],
                requires_vision_review: true,
            }),
            buildFieldEntry("RIM-09", "Sliced Pork Hot", 95, 105, {
                criticality: "critical",
                typical_values: [97, 98, 100, 101, 102],
                common_bad_ocr_values: [1, 7, 18],
                requires_vision_review: true,
            }),
            buildFieldEntry("RIM-10", "Diced Pork Hot", 95, 105, {
                criticality: "critical",
                typical_values: [97, 98, 100, 101, 102],
                common_bad_ocr_values: [1, 7, 18],
                requires_vision_review: true,
            }),
            buildFieldEntry("RIM-11", "Tapas Reach-In Top", 30, 45, {
                typical_values: [33, 34, 35, 36, 37],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("RIM-12", "Chicken Cold", 30, 40, {
                criticality: "critical",
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7, 138],
                requires_vision_review: true,
            }),
            buildFieldEntry("RIM-13", "Pork Cold", 30, 40, {
                criticality: "critical",
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7, 138],
                requires_vision_review: true,
            }),
            buildFieldEntry("RIM-14", "Tapas Reach-In Below", 30, 45, {
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("RIM-15", "Walk-In Produce Recheck", 30, 45, {
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("RIM-16", "Fryer Left", 350, 360, {
                criticality: "critical",
                typical_values: [350, 352, 355, 358, 360],
                common_bad_ocr_values: [1, 7, 138, 300, 56],
                requires_vision_review: true,
            }),
            buildFieldEntry("RIM-17", "Fryer Right", 350, 360, {
                criticality: "critical",
                typical_values: [350, 352, 355, 358, 360],
                common_bad_ocr_values: [1, 7, 138, 300, 56],
                requires_vision_review: true,
            }),
            buildFieldEntry("RIM-18", "Pasta Boiler Left", 200, 220, {
                criticality: "critical",
                typical_values: [200, 205, 210, 212, 215],
                common_bad_ocr_values: [1, 7, 20, 22],
                requires_vision_review: true,
            }),
            buildFieldEntry("RIM-19", "Pasta Boiler Right", 200, 220, {
                criticality: "critical",
                typical_values: [200, 205, 210, 212, 215],
                common_bad_ocr_values: [1, 7, 20, 22],
                requires_vision_review: true,
            }),
        ],
    },
    B2: {
        storeCode: "B2",
        storeName: "Stone Oak",
        fieldPrefix: "SO",
        fields: [
            buildFieldEntry("SO-01", "Walk-In Cooler (Produce)", 30, 45, {
                typical_values: [33, 34, 35, 36, 37, 38],
                common_bad_ocr_values: [1, 7, 138],
            }),
            buildFieldEntry("SO-02", "Walk-In Freezer", -20, 5, {
                typical_values: [-5, -2, 0, 1, 2, -10],
                common_bad_ocr_values: [200, 300, 400],
            }),
            buildFieldEntry("SO-03", "Prep Area Cooler", 30, 45, {
                typical_values: [33, 34, 35, 36, 37],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("SO-04", "Bowl Warmer", 100, 125, {
                typical_values: [105, 108, 110, 112, 115],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("SO-05", "Ramen Reach-In Top", 30, 45, {
                typical_values: [33, 34, 35, 36, 37],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("SO-06", "Ramen Reach-In Below", 30, 45, {
                typical_values: [33, 34, 35, 36, 37],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("SO-07", "Line Freezer", -20, 0, {
                typical_values: [-5, -2, -8, -10, 0],
                common_bad_ocr_values: [200, 300],
            }),
            buildFieldEntry("SO-08", "Seasoned Eggs", 95, 105, {
                criticality: "critical",
                typical_values: [97, 98, 100, 101, 102],
                common_bad_ocr_values: [1, 7, 18],
                requires_vision_review: true,
            }),
            buildFieldEntry("SO-09", "Sliced Pork Hot", 95, 105, {
                criticality: "critical",
                typical_values: [97, 98, 100, 101, 102],
                common_bad_ocr_values: [1, 7, 18],
                requires_vision_review: true,
            }),
            buildFieldEntry("SO-10", "Diced Pork Hot", 95, 105, {
                criticality: "critical",
                typical_values: [97, 98, 100, 101, 102],
                common_bad_ocr_values: [1, 7, 18],
                requires_vision_review: true,
            }),
            buildFieldEntry("SO-11", "Tapas Reach-In Top", 30, 45, {
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("SO-12", "Chicken Cold", 30, 40, {
                criticality: "critical",
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7, 138],
                requires_vision_review: true,
            }),
            buildFieldEntry("SO-13", "Pork Cold", 30, 40, {
                criticality: "critical",
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7, 138],
                requires_vision_review: true,
            }),
            buildFieldEntry("SO-14", "Tapas Reach-In Below", 30, 45, {
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("SO-15", "Walk-In Produce Recheck", 30, 45, {
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("SO-16", "Fryer Left", 350, 360, {
                criticality: "critical",
                typical_values: [350, 352, 355, 358, 360],
                common_bad_ocr_values: [1, 7, 138, 300, 56],
                requires_vision_review: true,
            }),
            buildFieldEntry("SO-17", "Fryer Right", 350, 360, {
                criticality: "critical",
                typical_values: [350, 352, 355, 358, 360],
                common_bad_ocr_values: [1, 7, 138, 300, 56],
                requires_vision_review: true,
            }),
            buildFieldEntry("SO-18", "Pasta Boiler Left", 200, 220, {
                criticality: "critical",
                typical_values: [200, 205, 210, 212, 215],
                common_bad_ocr_values: [1, 7, 20, 22],
                requires_vision_review: true,
            }),
            buildFieldEntry("SO-19", "Pasta Boiler Right", 200, 220, {
                criticality: "critical",
                typical_values: [200, 205, 210, 212, 215],
                common_bad_ocr_values: [1, 7, 20, 22],
                requires_vision_review: true,
            }),
        ],
    },
    B3: {
        storeCode: "B3",
        storeName: "Bandera",
        fieldPrefix: "BAN",
        fields: [
            buildFieldEntry("BAN-01", "Walk-In Cooler (Produce)", 30, 45, {
                typical_values: [33, 34, 35, 36, 37, 38],
                common_bad_ocr_values: [1, 7, 138],
            }),
            buildFieldEntry("BAN-02", "Walk-In Freezer", -20, 5, {
                typical_values: [-5, -2, 0, 1, 2, -10],
                common_bad_ocr_values: [200, 300, 400],
            }),
            buildFieldEntry("BAN-03", "Prep Area Cooler", 30, 45, {
                typical_values: [33, 34, 35, 36, 37],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("BAN-04", "Bowl Warmer", 100, 125, {
                typical_values: [105, 108, 110, 112, 115],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("BAN-05", "Ramen Reach-In Top", 30, 45, {
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("BAN-06", "Ramen Reach-In Below", 30, 45, {
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("BAN-07", "Line Freezer", -20, 0, {
                typical_values: [-5, -2, -8, -10, 0],
                common_bad_ocr_values: [200, 300],
            }),
            buildFieldEntry("BAN-08", "Seasoned Eggs", 95, 105, {
                criticality: "critical",
                typical_values: [97, 98, 100, 101, 102],
                common_bad_ocr_values: [1, 7, 18],
                requires_vision_review: true,
            }),
            buildFieldEntry("BAN-09", "Sliced Pork Hot", 95, 105, {
                criticality: "critical",
                typical_values: [97, 98, 100, 101, 102],
                common_bad_ocr_values: [1, 7, 18],
                requires_vision_review: true,
            }),
            buildFieldEntry("BAN-10", "Diced Pork Hot", 95, 105, {
                criticality: "critical",
                typical_values: [97, 98, 100, 101, 102],
                common_bad_ocr_values: [1, 7, 18],
                requires_vision_review: true,
            }),
            buildFieldEntry("BAN-11", "Tapas Reach-In Top", 30, 45, {
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("BAN-12", "Chicken Cold", 30, 40, {
                criticality: "critical",
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7, 138],
                requires_vision_review: true,
            }),
            buildFieldEntry("BAN-13", "Pork Cold", 30, 40, {
                criticality: "critical",
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7, 138],
                requires_vision_review: true,
            }),
            buildFieldEntry("BAN-14", "Tapas Reach-In Below", 30, 45, {
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("BAN-15", "Walk-In Produce Recheck", 30, 45, {
                typical_values: [33, 34, 35, 36],
                common_bad_ocr_values: [1, 7],
            }),
            buildFieldEntry("BAN-16", "Fryer Left", 350, 360, {
                criticality: "critical",
                typical_values: [350, 352, 355, 358, 360],
                common_bad_ocr_values: [1, 7, 138, 300, 56],
                requires_vision_review: true,
            }),
            buildFieldEntry("BAN-17", "Fryer Right", 350, 360, {
                criticality: "critical",
                typical_values: [350, 352, 355, 358, 360],
                common_bad_ocr_values: [1, 7, 138, 300, 56],
                requires_vision_review: true,
            }),
            buildFieldEntry("BAN-18", "Pasta Boiler Left", 200, 220, {
                criticality: "critical",
                typical_values: [200, 205, 210, 212, 215],
                common_bad_ocr_values: [1, 7, 20, 22],
                requires_vision_review: true,
            }),
            buildFieldEntry("BAN-19", "Pasta Boiler Right", 200, 220, {
                criticality: "critical",
                typical_values: [200, 205, 210, 212, 215],
                common_bad_ocr_values: [1, 7, 20, 22],
                requires_vision_review: true,
            }),
        ],
    },
};

// ─── Lookup Functions ────────────────────────────────────────────────

function getFieldKnowledge(storeCode, fieldId) {
    const store = STORE_KNOWLEDGE[storeCode];
    if (!store) return null;
    return store.fields.find(f => f.field_id === fieldId) || null;
}

function getStoreKnowledge(storeCode) {
    return STORE_KNOWLEDGE[storeCode] || null;
}

function isCommonBadOcrValue(storeCode, fieldId, ocrValue) {
    const field = getFieldKnowledge(storeCode, fieldId);
    if (!field) return false;
    const n = Number(ocrValue);
    if (!Number.isFinite(n)) return false;
    return field.common_bad_ocr_values.includes(n);
}

function isCriticalField(storeCode, fieldId) {
    const field = getFieldKnowledge(storeCode, fieldId);
    return field ? field.criticality === "critical" : false;
}

function needsVisionReview(storeCode, fieldId, opts = {}) {
    const field = getFieldKnowledge(storeCode, fieldId);
    if (!field) return false;
    if (!field.requires_vision_review) return false;
    // Vision review needed when: field is critical AND (low confidence, memory conflict, out of range, or blank uncertainty)
    if (opts.lowConfidence) return true;
    if (opts.memoryConflict) return true;
    if (opts.outOfRange) return true;
    if (opts.blankOrDash) return true;
    return field.requires_vision_review;
}

function getTypicalValues(storeCode, fieldId) {
    const field = getFieldKnowledge(storeCode, fieldId);
    return field ? field.typical_values : [];
}

function isTypicalValue(storeCode, fieldId, value) {
    const typical = getTypicalValues(storeCode, fieldId);
    return typical.includes(Number(value));
}

function getFieldsRequiringVisionReview(storeCode) {
    const store = STORE_KNOWLEDGE[storeCode];
    if (!store) return [];
    return store.fields.filter(f => f.requires_vision_review);
}

function getAllStoreCodes() {
    return Object.keys(STORE_KNOWLEDGE);
}

module.exports = {
    STORE_KNOWLEDGE,
    getFieldKnowledge,
    getStoreKnowledge,
    isCommonBadOcrValue,
    isCriticalField,
    needsVisionReview,
    getTypicalValues,
    isTypicalValue,
    getFieldsRequiringVisionReview,
    getAllStoreCodes,
};
