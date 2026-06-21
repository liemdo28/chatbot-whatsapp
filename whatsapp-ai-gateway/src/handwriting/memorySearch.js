/**
 * memorySearch.js — Phase 4: Handwriting Memory Search
 * 
 * When OCR is uncertain, search prior confirmed samples.
 * Search scope priority:
 *   1. Same employee + same store + same field_id
 *   2. Same employee + same store
 *   3. Same store + same field_id
 *   4. Same store
 *   5. Global samples
 */

const logger = require("../logger");
const db = require("../database");
const { fingerprintSimilarity } = require("./featureExtraction");

/**
 * Search memory for matching confirmed samples
 * @param {Object} opts - Search options
 * @param {string} opts.store_code - Store code (e.g., "B2")
 * @param {string} opts.field_id - Field ID (e.g., "SO-01")
 * @param {string} opts.employee_name - Employee name (optional)
 * @param {string} opts.employee_phone - Employee phone (optional)
 * @param {string} opts.template_id - Template ID (optional)
 * @param {string} opts.current_fingerprint - Current cell image fingerprint for visual similarity
 * @param {number} opts.limit - Max results (default 10)
 * @returns {Array} Array of matched samples with similarity scores
 */
async function searchMemory(opts = {}) {
    const {
        store_code,
        field_id,
        employee_name,
        employee_phone,
        template_id,
        current_fingerprint,
        limit = 10,
    } = opts;

    const allMatches = [];
    const seen = new Set();

    // Search priority levels
    const searchLevels = buildSearchLevels(opts);

    for (const level of searchLevels) {
        const candidates = db.getAll(level.sql, level.params);

        for (const candidate of candidates) {
            const key = `${candidate.sample_id}`;
            if (seen.has(key)) continue;
            seen.add(key);

            // Calculate similarity score
            let similarityScore = 0;

            // Visual similarity (if fingerprint available)
            if (current_fingerprint && candidate.fingerprint) {
                similarityScore = fingerprintSimilarity(current_fingerprint, candidate.fingerprint);
            }

            // Value consistency bonus: if previous confirmed values cluster around a value
            const valueConfidence = calculateValueConfidence(
                candidate.confirmed_value,
                level.priority
            );

            // Combined score: visual similarity (50%) + priority (30%) + value confidence (20%)
            const combinedScore =
                similarityScore * 0.5 +
                (1 - level.priority / 5) * 0.3 +  // Higher priority = lower number = higher score
                valueConfidence * 0.2;

            allMatches.push({
                matched_sample_id: candidate.sample_id,
                confirmed_value: candidate.confirmed_value,
                similarity_score: combinedScore,
                visual_similarity: similarityScore,
                employee_name: candidate.employee_name,
                employee_phone: candidate.employee_phone,
                store_code: candidate.store_code,
                field_id: candidate.field_id,
                column: candidate.column,
                created_at: candidate.created_at,
                source_action: candidate.source_action,
                search_priority: level.priority,
                search_level: level.label,
            });
        }

        // If we found good matches at this priority level, don't go lower
        const goodMatches = allMatches.filter(m => m.search_priority === level.priority && m.similarity_score > 0.5);
        if (goodMatches.length >= 3) break;
    }

    // Sort by similarity score descending
    allMatches.sort((a, b) => b.similarity_score - a.similarity_score);

    // Return top N
    return allMatches.slice(0, limit);
}

/**
 * Build search levels based on available context
 */
function buildSearchLevels(opts) {
    const levels = [];
    const { store_code, field_id, employee_name, employee_phone } = opts;

    // Level 1: Same employee + same store + same field
    if ((employee_name || employee_phone) && store_code && field_id) {
        levels.push({
            priority: 1,
            label: "employee+store+field",
            sql: `SELECT * FROM handwriting_confirmed_samples
                  WHERE store_code = ? AND field_id = ?
                    AND ((employee_name = ? AND employee_name IS NOT NULL AND employee_name != '')
                         OR (employee_phone = ? AND employee_phone IS NOT NULL AND employee_phone != ''))
                  ORDER BY created_at DESC LIMIT 20`,
            params: [store_code, field_id, employee_name || "", employee_phone || ""],
        });
    }

    // Level 2: Same employee + same store
    if ((employee_name || employee_phone) && store_code) {
        levels.push({
            priority: 2,
            label: "employee+store",
            sql: `SELECT * FROM handwriting_confirmed_samples
                  WHERE store_code = ?
                    AND ((employee_name = ? AND employee_name IS NOT NULL AND employee_name != '')
                         OR (employee_phone = ? AND employee_phone IS NOT NULL AND employee_phone != ''))
                  ORDER BY created_at DESC LIMIT 20`,
            params: [store_code, employee_name || "", employee_phone || ""],
        });
    }

    // Level 3: Same store + same field
    if (store_code && field_id) {
        levels.push({
            priority: 3,
            label: "store+field",
            sql: `SELECT * FROM handwriting_confirmed_samples
                  WHERE store_code = ? AND field_id = ?
                  ORDER BY created_at DESC LIMIT 20`,
            params: [store_code, field_id],
        });
    }

    // Level 4: Same store
    if (store_code) {
        levels.push({
            priority: 4,
            label: "store",
            sql: `SELECT * FROM handwriting_confirmed_samples
                  WHERE store_code = ?
                  ORDER BY created_at DESC LIMIT 20`,
            params: [store_code],
        });
    }

    // Level 5: Global (only if ALLOW_GLOBAL_HANDWRITING_FALLBACK=true)
    if (process.env.ALLOW_GLOBAL_HANDWRITING_FALLBACK === "true") {
        levels.push({
            priority: 5,
            label: "global",
            sql: `SELECT * FROM handwriting_confirmed_samples
                  ORDER BY created_at DESC LIMIT 20`,
            params: [],
        });
    }

    return levels;
}

/**
 * Calculate value confidence based on how consistent the value is
 * with common temperature patterns
 */
function calculateValueConfidence(value, priority) {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return 0;

    // Common temperature ranges (higher confidence for typical values)
    const typicalRanges = [
        { min: -20, max: 5, confidence: 0.9 },    // Freezer
        { min: 30, max: 45, confidence: 0.9 },     // Cooler
        { min: 95, max: 105, confidence: 0.85 },   // Hot holding
        { min: 135, max: 200, confidence: 0.85 },  // Hot holding
        { min: 165, max: 200, confidence: 0.8 },   // Cooking
        { min: 350, max: 360, confidence: 0.8 },   // Fryer
        { min: 200, max: 220, confidence: 0.8 },   // Boiler
    ];

    for (const range of typicalRanges) {
        if (numValue >= range.min && numValue <= range.max) {
            return range.confidence;
        }
    }

    // Outside typical ranges but not impossible
    return 0.3;
}

/**
 * Get the most common value for a field at a store
 * Useful for fallback predictions
 */
function getMostCommonValue(storeCode, fieldId) {
    const row = db.getOne(
        `SELECT confirmed_value, COUNT(*) as count
         FROM handwriting_confirmed_samples
         WHERE store_code = ? AND field_id = ?
         GROUP BY confirmed_value
         ORDER BY count DESC LIMIT 1`,
        [storeCode, fieldId]
    );
    return row ? { value: row.confirmed_value, count: row.count } : null;
}

/**
 * Get recent values for a field (time-weighted)
 */
function getRecentValues(storeCode, fieldId, limit = 5) {
    return db.getAll(
        `SELECT confirmed_value, created_at, source_action
         FROM handwriting_confirmed_samples
         WHERE store_code = ? AND field_id = ?
         ORDER BY created_at DESC LIMIT ?`,
        [storeCode, fieldId, limit]
    );
}

module.exports = {
    searchMemory,
    getMostCommonValue,
    getRecentValues,
    calculateValueConfidence,
};
