#!/usr/bin/env node
/**
 * cleanLegacyFoodSafetyRows.js — CEO DIRECTIVE: Food Safety Legacy Row Cleanup
 *
 * Mark all PENDING submissions as SUPERSEDED_LEGACY if they came from the
 * legacy OCR/Vision pipeline (image_path IS NOT NULL or runtime_pipeline
 * includes OCR/Vision markers).
 *
 * Confirmed numeric submissions are NEVER touched.
 *
 * Safe to run multiple times. Safe to run while the bot is online (the
 * UPDATE is atomic; rows already marked SUPERSEDED_LEGACY are skipped).
 *
 * Usage:
 *   node scripts/cleanLegacyFoodSafetyRows.js [--dry-run]
 */

const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const dbPath = process.env.GATEWAY_DB_PATH || path.join(projectRoot, "data", "gateway.db");

if (!fs.existsSync(dbPath)) {
    console.error(`[LEGACY_CLEANUP] No database at ${dbPath}; nothing to do.`);
    process.exit(0);
}

const initSqlJs = require(path.join(projectRoot, "node_modules", "sql.js"));
const logger = require(path.join(projectRoot, "src", "logger"));

(async () => {
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    function all(sql, params = []) {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
    }

    function run(sql, params = []) {
        db.run(sql, params);
    }

    function save() {
        const data = db.export();
        fs.writeFileSync(dbPath, Buffer.from(data));
    }

    console.log(`[LEGACY_CLEANUP] DB: ${dbPath}`);
    console.log(`[LEGACY_CLEANUP] Mode: ${dryRun ? "DRY-RUN" : "LIVE"}`);

    // 1. Inventory PENDING rows that came from image pipelines
    const pendingImage = all(
        `SELECT id, store_name, phone_number, status, image_path, ocr_json, created_at
           FROM food_safety_submissions
          WHERE status = 'PENDING' AND image_path IS NOT NULL AND image_path <> ''
          ORDER BY id DESC`
    );
    console.log(`[LEGACY_CLEANUP] PENDING rows with image_path set: ${pendingImage.length}`);

    // 2. Inventory PENDING rows whose ocr_json mentions OCR / Vision markers
    const pendingVision = all(
        `SELECT id, store_name, phone_number, status, image_path, ocr_json
           FROM food_safety_submissions
          WHERE status = 'PENDING'
            AND (ocr_json LIKE '%python_vision_llm_pipeline%'
              OR  ocr_json LIKE '%gpt4o_vision_primary%'
              OR  ocr_json LIKE '%legacy_ocr_explicit%'
              OR  ocr_json LIKE '%openai/gpt-4o%'
              OR  ocr_json LIKE '%gemini-flash%'
              OR  ocr_json LIKE '%processSubmissionBatch%')
          ORDER BY id DESC`
    );
    console.log(`[LEGACY_CLEANUP] PENDING rows with OCR/Vision json markers: ${pendingVision.length}`);

    // 3. Inventory PENDING rows that have NO image AND NO ocr_json markers
    //    (these are pure numeric-text entries — KEEP them)
    const pendingNumeric = all(
        `SELECT id, store_name, phone_number, status
           FROM food_safety_submissions
          WHERE status = 'PENDING'
            AND (image_path IS NULL OR image_path = '')
            AND ocr_json LIKE '%numeric_text_entry%'
          ORDER BY id DESC`
    );
    console.log(`[LEGACY_CLEANUP] PENDING numeric-text rows (will NOT be touched): ${pendingNumeric.length}`);

    // Union IDs to supersede
    const idsToSupersede = new Set();
    for (const r of pendingImage) idsToSupersede.add(r.id);
    for (const r of pendingVision) idsToSupersede.add(r.id);
    for (const r of pendingNumeric) idsToSupersede.delete(r.id); // safety

    if (idsToSupersede.size === 0) {
        console.log(`[LEGACY_CLEANUP] No legacy rows to clean.`);
        db.close();
        return;
    }

    if (dryRun) {
        console.log(`[LEGACY_CLEANUP] DRY-RUN — would mark ${idsToSupersede.size} rows as SUPERSEDED_LEGACY:`);
        for (const id of idsToSupersede) console.log(`   - id=${id}`);
        db.close();
        return;
    }

    // 4. Mark each legacy PENDING row as SUPERSEDED_LEGACY
    const placeholders = Array.from(idsToSupersede).map(() => "?").join(",");
    run(
        `UPDATE food_safety_submissions
            SET status = 'SUPERSEDED_LEGACY',
                updated_at = datetime('now')
          WHERE id IN (${placeholders})
            AND status = 'PENDING'`,
        Array.from(idsToSupersede)
    );
    save();

    // 5. Verify
    const remaining = all(
        `SELECT id, status FROM food_safety_submissions WHERE id IN (${placeholders}) ORDER BY id DESC`,
        Array.from(idsToSupersede)
    );
    console.log(`[LEGACY_CLEANUP] Updated rows:`);
    for (const r of remaining) {
        console.log(`   - id=${r.id} status=${r.status}`);
    }

    // 6. Cancel any retry queues pointing at superseded rows (they can never succeed)
    run(
        `UPDATE google_sheet_retry_queue
            SET status = 'CANCELLED',
                updated_at = datetime('now')
          WHERE submission_id IN (${placeholders})
            AND status = 'PENDING'`,
        Array.from(idsToSupersede)
    );
    save();

    console.log(`[LEGACY_CLEANUP] DONE — ${idsToSupersede.size} legacy PENDING rows superseded.`);

    db.close();
})().catch((err) => {
    console.error("[LEGACY_CLEANUP] FAILED", { error: err.message, stack: err.stack });
    process.exit(1);
});