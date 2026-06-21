/**
 * crossFieldIntelligence.js — Phase 3: Cross-Field Intelligence
 *
 * Uses neighboring/related fields to detect impossible OCR pairs
 * and auto-correct via prediction.
 *
 * Example: SO-16 Fryer Left + SO-17 Fryer Right
 *   Historical range: 350-360
 *   OCR reads: 138, 138
 *   System detects: IMPOSSIBLE PAIR → switches to Prediction Required
 *
 * Field groups (related fields that should have similar values):
 *   - Fryer pair: XX-16, XX-17 (range 350-360)
 *   - Boiler pair: XX-18, XX-19 (range 200-220)
 *   - Walk-in coolers: XX-01, XX-03, XX-05, XX-06, XX-11, XX-14, XX-15 (range 30-45)
 *   - Hot holding: XX-08, XX-09, XX-10 (range 95-105)
 *   - Freezer: XX-02, XX-07 (range -20 to 5)
 */

const logger = require("./logger");

// ─── Field Group Definitions ─────────────────────────────────────────

// Each group defines fields that are physically related and should
// produce similar temperature readings.
const FIELD_GROUPS = {
    FRYER_PAIR: {
        pattern: /[A-Z]+-(?:16|17)$/i,
        label: "Fryer Pair",
        maxSpread: 15, // Max difference between the two fryers (degrees F)
        historicalMin: 340,
        historicalMax: 365,
        impossibleBelow: 300, // If both fryers read below this, OCR failed
    },
    BOILER_PAIR: {
        pattern: /[A-Z]+-(?:18|19)$/i,
        label: "Pasta Boiler Pair",
        maxSpread: 25,
        historicalMin: 195,
        historicalMax: 225,
        impossibleBelow: 150,
    },
    WALKIN_COOLERS: {
        pattern: /[A-Z]+-(?:01|03|05|06|11|14|15)$/i,
        label: "Walk-in Coolers",
        maxSpread: 20,
        historicalMin: 28,
        historicalMax: 48,
        impossibleBelow: 10,
        impossibleAbove: 60,
    },
    HOT_HOLDING: {
        pattern: /[A-Z]+-(?:08|09|10)$/i,
        label: "Hot Holding",
        maxSpread: 15,
        historicalMin: 93,
        historicalMax: 110,
        impossibleBelow: 50,
    },
    FREEZERS: {
        pattern: /[A-Z]+-(?:02|07)$/i,
        label: "Freezers",
        maxSpread: 20,
        historicalMin: -25,
        historicalMax: 8,
        impossibleAbove: 50,
    },
    BOWL_WARMER: {
        pattern: /[A-Z]+-04$/i,
        label: "Bowl Warmer",
        maxSpread: null, // Single field
        historicalMin: 98,
        historicalMax: 128,
        impossibleBelow: 50,
    },
    CHICKEN_PORK_COLD: {
        pattern: /[A-Z]+-(?:12|13)$/i,
        label: "Chicken/Pork Cold",
        maxSpread: 10,
        historicalMin: 28,
        historicalMax: 42,
        impossibleBelow: 10,
    },
};

// ─── Detection Functions ─────────────────────────────────────────────

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * Determine which field group a field ID belongs to.
 */
function getFieldGroup(fieldId) {
    if (!fieldId) return null;
    for (const [groupName, group] of Object.entries(FIELD_GROUPS)) {
        if (group.pattern.test(fieldId)) return { groupName, ...group };
    }
    return null;
}

/**
 * Analyze all fields for cross-field anomalies.
 * Returns list of fields that need prediction instead of OCR trust.
 *
 * @param {Array} items - parsed form items with detectedValue, field_id, safeRange
 * @param {Object} memoryData - { fieldId -> { recentValues: [...], median: N } }
 * @returns {Object} { anomalies: [...], correctedFields: Set<fieldId> }
 */
function analyzeCrossField(items, memoryData) {
    const anomalies = [];
    const correctedFields = new Set();
    const fieldMap = new Map();

    // Build field map
    for (const item of items) {
        const id = item.field_id || item.id;
        const val = toNumber(item.detectedValue);
        fieldMap.set(id, { item, value: val });
    }

    // Group fields by their group
    const groups = new Map();
    for (const [id, data] of fieldMap) {
        const groupInfo = getFieldGroup(id);
        if (!groupInfo) continue;
        if (!groups.has(groupInfo.groupName)) {
            groups.set(groupInfo.groupName, { info: groupInfo, fields: [] });
        }
        groups.get(groupInfo.groupName).fields.push({ id, ...data, groupInfo });
    }

    // Analyze each group
    for (const [groupName, group] of groups) {
        const { info, fields } = group;
        const validFields = fields.filter(f => f.value !== null);

        if (validFields.length === 0) continue;

        // Check for impossible pairs (all fields in group read impossibly low/high)
        if (info.impossibleBelow !== undefined) {
            const allImpossible = validFields.every(f => f.value < info.impossibleBelow);
            if (allImpossible && validFields.length >= 2) {
                // All OCR reads are physically impossible — switch all to prediction
                for (const f of validFields) {
                    anomalies.push({
                        fieldId: f.id,
                        type: "IMPOSSIBLE_GROUP_READ",
                        groupName: info.label,
                        ocrValue: f.value,
                        reason: `All ${info.label} fields read ${f.value}F, which is physically impossible (expected ${info.historicalMin}-${info.historicalMax}F)`,
                        action: "PREDICTION_REQUIRED",
                    });
                    correctedFields.add(f.id);
                }
                continue;
            }
        }

        if (info.impossibleAbove !== undefined) {
            const allImpossible = validFields.every(f => f.value > info.impossibleAbove);
            if (allImpossible && validFields.length >= 2) {
                for (const f of validFields) {
                    anomalies.push({
                        fieldId: f.id,
                        type: "IMPOSSIBLE_GROUP_READ",
                        groupName: info.label,
                        ocrValue: f.value,
                        reason: `All ${info.label} fields read ${f.value}F, which is physically impossible (expected ${info.historicalMin}-${info.historicalMax}F)`,
                        action: "PREDICTION_REQUIRED",
                    });
                    correctedFields.add(f.id);
                }
                continue;
            }
        }

        // Check for spread anomaly (pair fields that should be similar but aren't)
        if (info.maxSpread !== null && validFields.length >= 2) {
            const values = validFields.map(f => f.value);
            const min = Math.min(...values);
            const max = Math.max(...values);
            const spread = max - min;

            if (spread > info.maxSpread * 2) {
                // Extreme spread — one or both are likely wrong
                for (const f of validFields) {
                    // If this field's value is far from the group median, flag it
                    const median = values.reduce((a, b) => a + b, 0) / values.length;
                    const deviation = Math.abs(f.value - median);
                    if (deviation > info.maxSpread) {
                        anomalies.push({
                            fieldId: f.id,
                            type: "PAIR_SPREAD_ANOMALY",
                            groupName: info.label,
                            ocrValue: f.value,
                            groupMedian: Math.round(median),
                            spread,
                            reason: `${info.label} pair spread ${spread}F exceeds max ${info.maxSpread}F`,
                            action: "PREDICTION_REQUIRED",
                        });
                        correctedFields.add(f.id);
                    }
                }
            }
        }

        // Check individual fields against historical bounds
        for (const f of validFields) {
            if (correctedFields.has(f.id)) continue; // Already flagged

            const belowImpossible = info.impossibleBelow !== undefined && f.value < info.impossibleBelow;
            const aboveImpossible = info.impossibleAbove !== undefined && f.value > info.impossibleAbove;

            if (belowImpossible || aboveImpossible) {
                // Single field reads impossibly — try memory correction
                const memData = memoryData && memoryData[f.id];
                if (memData && memData.median !== null && memData.median !== undefined) {
                    anomalies.push({
                        fieldId: f.id,
                        type: "SINGLE_FIELD_IMPOSSIBLE",
                        groupName: info.label,
                        ocrValue: f.value,
                        memoryMedian: memData.median,
                        reason: `${f.id} reads ${f.value}F (impossible for ${info.label}), memory suggests ${memData.median}F`,
                        action: "MEMORY_OVERRIDE",
                    });
                    correctedFields.add(f.id);
                } else {
                    anomalies.push({
                        fieldId: f.id,
                        type: "SINGLE_FIELD_IMPOSSIBLE_NO_MEMORY",
                        groupName: info.label,
                        ocrValue: f.value,
                        reason: `${f.id} reads ${f.value}F (impossible for ${info.label}), no memory available`,
                        action: "CONFIRMATION_REQUIRED",
                    });
                    correctedFields.add(f.id);
                }
            }
        }
    }

    if (anomalies.length > 0) {
        logger.info("[CROSS_FIELD] Anomalies detected", {
            count: anomalies.length,
            correctedCount: correctedFields.size,
            types: anomalies.map(a => a.type),
        });
    }

    return { anomalies, correctedFields };
}

/**
 * Get memory data for cross-field analysis.
 * Returns a map of fieldId -> { recentValues: [...], median: N }
 */
function getMemoryContextForGroups(items, storeCode, memorySearchFn) {
    const context = {};
    const searchPromises = [];

    for (const item of items) {
        const id = item.field_id || item.id;
        const group = getFieldGroup(id);
        if (!group) continue; // Only fetch for grouped fields

        const promise = (async () => {
            try {
                const matches = await memorySearchFn({
                    store_code: storeCode,
                    field_id: id,
                    limit: 10,
                });
                const values = matches
                    .map(m => toNumber(m.confirmed_value))
                    .filter(v => v !== null);

                if (values.length > 0) {
                    const sorted = [...values].sort((a, b) => a - b);
                    const median = sorted[Math.floor(sorted.length / 2)];
                    context[id] = {
                        recentValues: values,
                        median,
                        count: values.length,
                        min: sorted[0],
                        max: sorted[sorted.length - 1],
                    };
                }
            } catch (err) {
                logger.warn("[CROSS_FIELD] Memory lookup failed", { fieldId: id, error: err.message });
            }
        })();
        searchPromises.push(promise);
    }

    return Promise.all(searchPromises).then(() => context);
}

module.exports = {
    FIELD_GROUPS,
    getFieldGroup,
    analyzeCrossField,
    getMemoryContextForGroups,
    toNumber,
};
