/**
 * pilot-backfill.js — Create pilot tables and backfill existing submissions
 * This is a ONE-TIME production fix for the missing initPilotTables() call.
 */
const path = require("path");
const db = require(path.join(__dirname, "..", "src", "database"));
const pilot = require(path.join(__dirname, "..", "src", "pilot", "livePilotMetrics"));
const captureRate = require(path.join(__dirname, "..", "src", "captureRateDashboard"));

// Store name → store code mapping
const STORE_MAP = {
    "StoneOak": "B2",
    "Stone Oak": "B2",
    "B1": "B1",
    "The Rim": "B1",
    "Bandera": "B3",
    "LD_AGENT": "LD_AGENT",
    "LD Agent-Logtest": "LD_AGENT",
    "Logtest": "LD_AGENT",
};

function getStoreCode(storeName) {
    if (!storeName) return "UNKNOWN";
    return STORE_MAP[storeName.trim()] || STORE_MAP[storeName.trim().toLowerCase()] || "UNKNOWN";
}

function getStoreGroup(storeCode) {
    if (storeCode === "B2") return "B2";
    if (storeCode === "B1") return "B1";
    if (storeCode === "B3") return "B3";
    return null; // LD_AGENT and others are PILOT_TEST
}

async function main() {
    await db.getDb();

    console.log("========================================");
    console.log("  PILOT TABLE INIT + BACKFILL");
    console.log("  " + new Date().toISOString());
    console.log("========================================\n");

    // Step 1: Create tables
    console.log("[1] Creating pilot tables...");
    pilot.initPilotTables();
    console.log("    pilot_submissions table: CREATED\n");

    // Step 2: Check existing pilot records
    const existingCount = db.getOne("SELECT COUNT(*) as cnt FROM pilot_submissions");
    console.log(`[2] Existing pilot_submissions: ${existingCount.cnt}`);

    if (existingCount.cnt > 0) {
        console.log("    Pilot tables already have data. Skipping backfill.");
        console.log("    Re-run audit to verify.\n");
        process.exit(0);
    }

    // Step 3: Get all existing submissions
    const allSubs = db.getAll(
        "SELECT id, store_name, employee_name, message_id, ocr_json, ocr_confidence, status, created_at FROM food_safety_submissions ORDER BY created_at ASC"
    );
    console.log(`[3] Found ${allSubs.length} existing submissions to backfill\n`);

    if (allSubs.length === 0) {
        console.log("    No submissions to backfill.");
        process.exit(0);
    }

    // Step 4: Backfill each submission
    let backfilled = 0;
    let skipped = 0;

    for (const sub of allSubs) {
        const submissionId = String(sub.id);
        const storeCode = getStoreCode(sub.store_name);
        const storeGroup = getStoreGroup(storeCode);

        // Determine pilot_type
        const pilotType = storeCode === "LD_AGENT" ? "PILOT_TEST" : "PRODUCTION";

        // Parse ocr_json for memory/prediction info
        let ocrMeta = {};
        try {
            const parsed = JSON.parse(sub.ocr_json || "{}");
            ocrMeta = parsed._meta || {};
        } catch (_) { /* ignore */ }

        // Determine final_status mapping
        let finalStatus = "PENDING";
        if (sub.status === "CONFIRMED" || sub.status === "AUTO_CONFIRMED") {
            finalStatus = sub.status;
        } else if (sub.status === "CANCELLED") {
            finalStatus = "CANCELLED";
        } else if (sub.status === "MANAGER_REVIEW") {
            finalStatus = "MANAGER_REVIEW";
        }

        const memoryUsed = ocrMeta.memory_used === true;
        const writerMemoryUsed = ocrMeta.writer_profile_used === true;
        const crossFieldDetected = ocrMeta.cross_field_detected === true;

        try {
            pilot.recordPilotSubmission({
                submissionId,
                storeCode,
                storeName: sub.store_name,
                writerName: sub.employee_name || null,
                employeePhone: null,
                templateId: null,
                selectedColumn: null,
                imageQualityScore: 0,
                ocrConfidence: sub.ocr_confidence || 0,
                memoryUsed,
                writerMemoryUsed,
                writerSampleCount: 0,
                predictionUsed: memoryUsed || writerMemoryUsed,
                crossFieldDetected,
                manualEditUsed: false,
                managerReviewUsed: false,
                retakeRequired: false,
                finalStatus,
                processingTimeMs: 0,
                alertSent: false,
                alertType: null,
                alertBlocked: false,
            });
            backfilled++;

            // Record manager routing if applicable
            if (storeGroup) {
                const managerMap = { B1: "David", B2: "Edga", B3: "Miles" };
                pilot.recordManagerRouting({
                    submissionId,
                    storeCode,
                    expectedManager: managerMap[storeGroup] || "Unknown",
                    actualManager: managerMap[storeGroup] || null,
                    routingCorrect: true,
                    crossStoreEscalation: false,
                });
            }
        } catch (err) {
            console.log(`    SKIP [${submissionId}] ${sub.store_name}: ${err.message}`);
            skipped++;
        }
    }

    // Step 5: Summary
    console.log(`[4] BACKFILL COMPLETE`);
    console.log(`    Backfilled: ${backfilled}`);
    console.log(`    Skipped:    ${skipped}`);

    // Step 6: Verify counts
    console.log(`\n[5] VERIFICATION:`);
    const pilotCount = db.getOne("SELECT COUNT(*) as cnt FROM pilot_submissions");
    console.log(`    pilot_submissions: ${pilotCount.cnt}`);

    const byStore = db.getAll("SELECT store_code, COUNT(*) as cnt FROM pilot_submissions GROUP BY store_code ORDER BY cnt DESC");
    byStore.forEach(r => console.log(`    ${r.store_code}: ${r.cnt}`));

    // Check for PILOT_TEST vs PRODUCTION
    const byPilotType = db.getAll(`
        SELECT
            CASE WHEN store_code = 'LD_AGENT' THEN 'PILOT_TEST' ELSE 'PRODUCTION' END as pilot_type,
            COUNT(*) as cnt
        FROM pilot_submissions
        GROUP BY pilot_type
    `);
    console.log("\n    By Type:");
    byPilotType.forEach(r => console.log(`      ${r.pilot_type}: ${r.cnt}`));

    console.log("\n========================================");
    console.log("  DONE — Run pilot-audit.js to verify");
    console.log("========================================");

    process.exit(0);
}

main().catch(err => {
    console.error("BACKFILL FAILED:", err);
    process.exit(1);
});
