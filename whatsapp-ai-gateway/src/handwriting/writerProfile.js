/**
 * writerProfile.js — Phase 4: Writer Profile System
 *
 * Extracts and maintains writer/employee profiles for handwriting memory.
 *
 * Writer detection priority:
 *   1. 4PM employee field
 *   2. 10AM employee field
 *   3. Manager/signature field
 *   4. WhatsApp sender name as fallback
 *
 * Writer profile contains:
 *   - common misreads (e.g., "3" → "8", "0" → "O")
 *   - sample count
 *   - last seen
 *   - preferred value patterns
 */

const logger = require("../logger");
const db = require("../database");

/**
 * Detect writer name from a submission.
 * Checks employee fields in parsed items, WhatsApp sender, etc.
 */
function detectWriterFromSubmission(parsed, session, chatName) {
    // Check employee fields in the parsed items
    // Food safety forms typically have employee name fields
    // Look for field IDs that look like employee/name fields
    // or extract from session/chat metadata

    const candidates = [];

    // Session employee name (set during form processing)
    if (session && session.employeeName) {
        candidates.push({ name: session.employeeName, source: "session" });
    }

    // Try to extract from WhatsApp sender name
    if (chatName && chatName.includes(" ")) {
        const parts = chatName.split(" ");
        const firstName = parts[parts.length - 1]; // Last word often is the name
        if (firstName && firstName.length >= 2) {
            candidates.push({ name: firstName, source: "chat_name" });
        }
    }

    // Try to find an employee field in the form items
    // (Some forms have a dedicated employee name row)
    if (parsed && parsed.items) {
        for (const item of parsed.items) {
            const label = (item.label || item.item || "").toLowerCase();
            if (label.includes("employee") || label.includes("empleado") || label.includes("name") || label.includes("nombre")) {
                if (item.detectedValue && String(item.detectedValue).length >= 2) {
                    candidates.push({ name: String(item.detectedValue).trim(), source: "form_field" });
                }
            }
        }
    }

    // Return best candidate (form_field > session > chat_name)
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
        const priority = { form_field: 3, session: 2, chat_name: 1 };
        return (priority[b.source] || 0) - (priority[a.source] || 0);
    });
    return candidates[0].name;
}

/**
 * Get or create a writer profile for a writer+store combination.
 */
function getOrCreateWriterProfile(writerName, storeCode) {
    if (!writerName || !storeCode) return null;

    try {
        const existing = db.getOne(
            `SELECT * FROM handwriting_writer_profiles
             WHERE writer_name = ? AND store_code = ?`,
            [writerName, storeCode]
        );

        if (existing) {
            return existing;
        }

        // Create new profile
        db.run(
            `INSERT OR IGNORE INTO handwriting_writer_profiles
               (writer_name, store_code, sample_count, last_seen_at)
             VALUES (?, ?, 0, datetime('now'))`,
            [writerName, storeCode]
        );
        db.saveDb();
        return db.getOne(
            `SELECT * FROM handwriting_writer_profiles
             WHERE writer_name = ? AND store_code = ?`,
            [writerName, storeCode]
        );
    } catch (err) {
        logger.warn("Failed to get/create writer profile", { writerName, storeCode, error: err.message });
        return null;
    }
}

/**
 * Update writer profile sample count and misreads after a confirmation.
 */
function updateWriterProfile(writerName, storeCode, confirmedSamples) {
    if (!writerName || !storeCode) return;

    try {
        const profile = getOrCreateWriterProfile(writerName, storeCode);
        if (!profile) return;

        // Build misread map from confirmed samples
        const misreadMap = buildMisreadMap(confirmedSamples);
        const misreadJson = JSON.stringify(misreadMap);

        db.run(
            `UPDATE handwriting_writer_profiles
               SET sample_count = sample_count + ?,
                   common_misreads_json = ?,
                   last_seen_at = datetime('now')
             WHERE writer_name = ? AND store_code = ?`,
            [confirmedSamples.length, misreadJson, writerName, storeCode]
        );
        db.saveDb();
        logger.info("Writer profile updated", { writerName, storeCode, samples: confirmedSamples.length });
    } catch (err) {
        logger.warn("Failed to update writer profile", { writerName, storeCode, error: err.message });
    }
}

/**
 * Build a map of common OCR misreads for a writer.
 * E.g., { "3": ["8"], "0": ["O"], "360": ["300"] }
 */
function buildMisreadMap(samples) {
    const misreads = {};
    for (const sample of samples) {
        const ocrVal = String(sample.raw_ocr_value || "").trim();
        const confirmedVal = String(sample.confirmed_value || "").trim();
        if (!ocrVal || !confirmedVal) continue;
        if (ocrVal !== confirmedVal) {
            if (!misreads[ocrVal]) misreads[ocrVal] = [];
            if (!misreads[ocrVal].includes(confirmedVal)) {
                misreads[ocrVal].push(confirmedVal);
            }
        }
    }
    return misreads;
}

/**
 * Get common misreads for a writer (for prediction correction).
 */
function getWriterMisreads(writerName, storeCode) {
    try {
        const profile = db.getOne(
            `SELECT common_misreads_json FROM handwriting_writer_profiles
             WHERE writer_name = ? AND store_code = ?`,
            [writerName, storeCode]
        );
        if (profile && profile.common_misreads_json) {
            return JSON.parse(profile.common_misreads_json);
        }
    } catch (_) { }
    return {};
}

/**
 * Get all profiles for a store.
 */
function getWriterProfilesByStore(storeCode) {
    try {
        return db.getAll(
            `SELECT * FROM handwriting_writer_profiles WHERE store_code = ? ORDER BY sample_count DESC`,
            [storeCode]
        );
    } catch (_) { return []; }
}

module.exports = {
    detectWriterFromSubmission,
    getOrCreateWriterProfile,
    updateWriterProfile,
    buildMisreadMap,
    getWriterMisreads,
    getWriterProfilesByStore,
};
