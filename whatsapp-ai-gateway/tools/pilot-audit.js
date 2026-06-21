/**
 * pilot-audit.js — Quick DB audit for pilot telemetry integrity
 */
const path = require("path");
const db = require(path.join(__dirname, "..", "src", "database"));

async function main() {
    await db.getDb();

    console.log("========================================");
    console.log("  PILOT TELEMETRY AUDIT");
    console.log("  " + new Date().toISOString());
    console.log("========================================\n");

    // 1. All tables
    console.log("=== ALL TABLES ===");
    const tables = db.getAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    tables.forEach(t => console.log("  " + t.name));
    console.log("");

    // 2. food_safety_submissions (the main submission table)
    console.log("=== food_safety_submissions ===");
    const fsCount = db.getOne("SELECT COUNT(*) as cnt FROM food_safety_submissions");
    console.log("  Total rows: " + (fsCount ? fsCount.cnt : 0));

    if (fsCount && fsCount.cnt > 0) {
        const rows = db.getAll("SELECT id, store_name, employee_name, status, created_at FROM food_safety_submissions ORDER BY created_at DESC LIMIT 20");
        rows.forEach(r => {
            console.log(`  [${r.id}] ${r.store_name} | ${r.employee_name || 'null'} | ${r.status} | ${r.created_at}`);
        });

        // Store breakdown
        console.log("\n  By Store:");
        const byStore = db.getAll("SELECT store_name, COUNT(*) as cnt FROM food_safety_submissions GROUP BY store_name ORDER BY cnt DESC");
        byStore.forEach(r => console.log(`    ${r.store_name}: ${r.cnt}`));
    }
    console.log("");

    // 3. pilot_submissions (the pilot telemetry table)
    console.log("=== pilot_submissions (PILOT TELEMETRY) ===");
    try {
        const psCount = db.getOne("SELECT COUNT(*) as cnt FROM pilot_submissions");
        console.log("  Total rows: " + (psCount ? psCount.cnt : 0));
        if (psCount && psCount.cnt > 0) {
            const psRows = db.getAll("SELECT submission_id, store_code, store_name, writer_name, final_status, prediction_used, writer_memory_used, retake_required, created_at FROM pilot_submissions ORDER BY created_at DESC LIMIT 20");
            psRows.forEach(r => {
                console.log(`  [${r.submission_id}] ${r.store_code} | ${r.store_name} | ${r.writer_name || 'null'} | ${r.final_status} | pred=${r.prediction_used} mem=${r.writer_memory_used} retake=${r.retake_required} | ${r.created_at}`);
            });
            console.log("\n  By Store:");
            const psByStore = db.getAll("SELECT store_code, COUNT(*) as cnt FROM pilot_submissions GROUP BY store_code ORDER BY cnt DESC");
            psByStore.forEach(r => console.log(`    ${r.store_code}: ${r.cnt}`));
        }
    } catch (e) {
        console.log("  TABLE NOT FOUND: " + e.message);
    }
    console.log("");

    // 4. pilot_writer_memory_proof
    console.log("=== pilot_writer_memory_proof ===");
    try {
        const wmpCount = db.getOne("SELECT COUNT(*) as cnt FROM pilot_writer_memory_proof");
        console.log("  Total rows: " + (wmpCount ? wmpCount.cnt : 0));
        if (wmpCount && wmpCount.cnt > 0) {
            const byStore = db.getAll("SELECT store_code, COUNT(*) as cnt FROM pilot_writer_memory_proof GROUP BY store_code ORDER BY cnt DESC");
            byStore.forEach(r => console.log(`    ${r.store_code}: ${r.cnt} fields`));
        }
    } catch (e) {
        console.log("  TABLE NOT FOUND: " + e.message);
    }
    console.log("");

    // 5. pilot_alert_log
    console.log("=== pilot_alert_log ===");
    try {
        const alCount = db.getOne("SELECT COUNT(*) as cnt FROM pilot_alert_log");
        console.log("  Total rows: " + (alCount ? alCount.cnt : 0));
    } catch (e) {
        console.log("  TABLE NOT FOUND: " + e.message);
    }
    console.log("");

    // 6. pilot_manager_routing
    console.log("=== pilot_manager_routing ===");
    try {
        const mrCount = db.getOne("SELECT COUNT(*) as cnt FROM pilot_manager_routing");
        console.log("  Total rows: " + (mrCount ? mrCount.cnt : 0));
        if (mrCount && mrCount.cnt > 0) {
            const mrRows = db.getAll("SELECT store_code, expected_manager, routing_correct, COUNT(*) as cnt FROM pilot_manager_routing GROUP BY store_code, expected_manager, routing_correct");
            mrRows.forEach(r => console.log(`    ${r.store_code}: expected=${r.expected_manager} correct=${r.routing_correct} count=${r.cnt}`));
        }
    } catch (e) {
        console.log("  TABLE NOT FOUND: " + e.message);
    }
    console.log("");

    // 7. handwriting_forms
    console.log("=== handwriting_forms ===");
    try {
        const hfCount = db.getOne("SELECT COUNT(*) as cnt FROM handwriting_forms");
        console.log("  Total rows: " + (hfCount ? hfCount.cnt : 0));
        if (hfCount && hfCount.cnt > 0) {
            const hfRows = db.getAll("SELECT id, submission_id, store_code, store_name, chat_name, created_at FROM handwriting_forms ORDER BY created_at DESC LIMIT 10");
            hfRows.forEach(r => console.log(`  [${r.id}] sub=${r.submission_id} ${r.store_code} | ${r.store_name} | chat=${r.chat_name || 'null'} | ${r.created_at}`));
        }
    } catch (e) {
        console.log("  TABLE NOT FOUND: " + e.message);
    }
    console.log("");

    // 8. food_safety_decision_audit
    console.log("=== food_safety_decision_audit ===");
    try {
        const auditCount = db.getOne("SELECT COUNT(*) as cnt FROM food_safety_decision_audit");
        console.log("  Total rows: " + (auditCount ? auditCount.cnt : 0));
        if (auditCount && auditCount.cnt > 0) {
            const byStore = db.getAll("SELECT store_code, COUNT(*) as cnt FROM food_safety_decision_audit GROUP BY store_code ORDER BY cnt DESC");
            byStore.forEach(r => console.log(`    ${r.store_code}: ${r.cnt} field-level audits`));
            console.log("\n  By final_source:");
            const bySource = db.getAll("SELECT final_source, COUNT(*) as cnt FROM food_safety_decision_audit GROUP BY final_source ORDER BY cnt DESC");
            bySource.forEach(r => console.log(`    ${r.final_source}: ${r.cnt}`));
        }
    } catch (e) {
        console.log("  TABLE NOT FOUND: " + e.message);
    }
    console.log("");

    // 9. ceo_runtime_prediction_audit
    console.log("=== ceo_runtime_prediction_audit ===");
    try {
        const rpaCount = db.getOne("SELECT COUNT(*) as cnt FROM ceo_runtime_prediction_audit");
        console.log("  Total rows: " + (rpaCount ? rpaCount.cnt : 0));
        if (rpaCount && rpaCount.cnt > 0) {
            const byStore = db.getAll("SELECT store_code, COUNT(*) as cnt FROM ceo_runtime_prediction_audit GROUP BY store_code ORDER BY cnt DESC");
            byStore.forEach(r => console.log(`    ${r.store_code}: ${r.cnt}`));
        }
    } catch (e) {
        console.log("  TABLE NOT FOUND: " + e.message);
    }
    console.log("");

    // 10. food_safety_processing_lock (dedup)
    console.log("=== food_safety_processing_lock ===");
    try {
        const lockCount = db.getOne("SELECT COUNT(*) as cnt FROM food_safety_processing_lock");
        console.log("  Total rows: " + (lockCount ? lockCount.cnt : 0));
    } catch (e) {
        console.log("  TABLE NOT FOUND: " + e.message);
    }
    console.log("");

    // 11. message_log
    console.log("=== message_log ===");
    try {
        const mlCount = db.getOne("SELECT COUNT(*) as cnt FROM message_log");
        console.log("  Total rows: " + (mlCount ? mlCount.cnt : 0));
        if (mlCount && mlCount.cnt > 0) {
            const imgCount = db.getOne("SELECT COUNT(*) as cnt FROM message_log WHERE message_type = 'image'");
            console.log("  Image messages: " + (imgCount ? imgCount.cnt : 0));
        }
    } catch (e) {
        console.log("  TABLE NOT FOUND: " + e.message);
    }
    console.log("");

    // 12. Capture rate dashboard
    console.log("=== capture_rate_dashboard ===");
    try {
        const crCount = db.getOne("SELECT COUNT(*) as cnt FROM capture_rate_log");
        console.log("  capture_rate_log rows: " + (crCount ? crCount.cnt : 0));
    } catch (e) {
        console.log("  capture_rate_log NOT FOUND: " + e.message);
    }
    console.log("");

    // SUMMARY
    console.log("========================================");
    console.log("  AUDIT SUMMARY");
    console.log("========================================");
    const totalSubs = fsCount ? fsCount.cnt : 0;
    let pilotCount = 0;
    try { const r = db.getOne("SELECT COUNT(*) as cnt FROM pilot_submissions"); pilotCount = r ? r.cnt : 0; } catch (_) { }
    console.log(`  Total submissions (food_safety_submissions): ${totalSubs}`);
    console.log(`  Total pilot records (pilot_submissions):     ${pilotCount}`);
    console.log(`  GAP: ${totalSubs - pilotCount} submissions NOT in pilot telemetry`);
    console.log("");

    process.exit(0);
}

main().catch(err => {
    console.error("AUDIT FAILED:", err);
    process.exit(1);
});
