/**
 * livePilotMetrics.js — Phase 1-10: Production Pilot Telemetry
 *
 * Tracks all KPIs for the 100-form production pilot across B1, B2, B3.
 *
 * KPIs Tracked:
 *   Phase 1: Live audit telemetry (per-submission)
 *   Phase 2: Successful Capture Rate = Completed / Submitted
 *   Phase 3: Retake KPI (count, reason, percentage)
 *   Phase 4: Writer Memory Proof (OCR vs Memory vs Writer vs Final)
 *   Phase 5: Field Accuracy (raw OCR vs final accuracy)
 *   Phase 6: Alert Quality (true/false/blocked)
 *   Phase 7: Management Group Validation (David=B1, Edga=B2, Miles=B3)
 *   Phase 8: One Image One Reply Validation
 */

const fs = require("fs");
const path = require("path");
const logger = require("../logger");
const db = require("../database");

// ─── Pilot Config ─────────────────────────────────────────────────────

const PILOT_CONFIG = {
    targetForms: 100,
    targetByStore: {
        B1: 30,
        B2: 30,
        B3: 30,
        LD_AGENT: 10,
    },
    captureRateTarget: 95,   // >=95%
    retakeRateMax: 5,        // <=5%
    finalAccuracyTarget: 90,  // >=90%
    rawOcrAccuracyTarget: 70, // >=70%
    falseAlertTarget: 0,
};

// ─── Pilot Tables ─────────────────────────────────────────────────────

function initPilotTables() {
    // Main pilot submission log
    db.run(`
        CREATE TABLE IF NOT EXISTS pilot_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id TEXT UNIQUE NOT NULL,
            store_code TEXT NOT NULL,
            store_name TEXT,
            writer_name TEXT,
            employee_phone TEXT,
            template_id TEXT,
            selected_column TEXT,
            image_quality_score INTEGER DEFAULT 0,
            ocr_confidence REAL DEFAULT 0,
            memory_used INTEGER DEFAULT 0,
            writer_memory_used INTEGER DEFAULT 0,
            writer_sample_count INTEGER DEFAULT 0,
            prediction_used INTEGER DEFAULT 0,
            cross_field_detected INTEGER DEFAULT 0,
            manual_edit_used INTEGER DEFAULT 0,
            manager_review_used INTEGER DEFAULT 0,
            retake_required INTEGER DEFAULT 0,
            retake_reason TEXT,
            final_status TEXT DEFAULT 'PENDING',
            processing_time_ms INTEGER DEFAULT 0,
            alert_sent INTEGER DEFAULT 0,
            alert_type TEXT,
            alert_blocked INTEGER DEFAULT 0,
            pilot_verified INTEGER DEFAULT 0,
            ground_truth_verified INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            confirmed_at TEXT
        )
    `);

    // Writer memory proof log — one row per field prediction
    db.run(`
        CREATE TABLE IF NOT EXISTS pilot_writer_memory_proof (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id TEXT NOT NULL,
            store_code TEXT NOT NULL,
            field_id TEXT NOT NULL,
            column_label TEXT,
            ocr_raw_value TEXT,
            ocr_confidence REAL DEFAULT 0,
            memory_value TEXT,
            writer_profile_value TEXT,
            writer_sample_count INTEGER DEFAULT 0,
            predicted_value TEXT,
            prediction_source TEXT,
            prediction_confidence REAL DEFAULT 0,
            final_value TEXT,
            was_edited INTEGER DEFAULT 0,
            was_confirmed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Field accuracy ground truth (for Phase 5 validation)
    db.run(`
        CREATE TABLE IF NOT EXISTS pilot_field_accuracy (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id TEXT NOT NULL,
            store_code TEXT NOT NULL,
            field_id TEXT NOT NULL,
            column_label TEXT,
            ground_truth_value TEXT,
            ocr_value TEXT,
            memory_value TEXT,
            writer_memory_value TEXT,
            final_value TEXT,
            accuracy_source TEXT DEFAULT 'MANUAL',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Alert quality log
    db.run(`
        CREATE TABLE IF NOT EXISTS pilot_alert_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id TEXT NOT NULL,
            store_code TEXT NOT NULL,
            alert_type TEXT NOT NULL,
            alert_category TEXT DEFAULT 'UNSAFE_TEMPERATURE',
            is_true_alert INTEGER DEFAULT 0,
            is_false_alert INTEGER DEFAULT 0,
            is_blocked INTEGER DEFAULT 0,
            blocked_reason TEXT,
            escalated_to TEXT,
            manager_name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Management routing validation
    db.run(`
        CREATE TABLE IF NOT EXISTS pilot_manager_routing (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id TEXT NOT NULL,
            store_code TEXT NOT NULL,
            expected_manager TEXT NOT NULL,
            actual_manager TEXT,
            routing_correct INTEGER DEFAULT 0,
            cross_store_escalation INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Pilot summary
    db.run(`
        CREATE TABLE IF NOT EXISTS pilot_summary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            total_submitted INTEGER DEFAULT 0,
            total_completed INTEGER DEFAULT 0,
            total_failed INTEGER DEFAULT 0,
            total_retaken INTEGER DEFAULT 0,
            successful_capture_rate REAL DEFAULT 0,
            retake_rate REAL DEFAULT 0,
            raw_ocr_accuracy REAL DEFAULT 0,
            final_accuracy REAL DEFAULT 0,
            memory_usage_rate REAL DEFAULT 0,
            writer_memory_usage_rate REAL DEFAULT 0,
            prediction_usage_rate REAL DEFAULT 0,
            manual_edit_rate REAL DEFAULT 0,
            manager_review_rate REAL DEFAULT 0,
            alert_true_count INTEGER DEFAULT 0,
            alert_false_count INTEGER DEFAULT 0,
            alert_blocked_count INTEGER DEFAULT 0,
            avg_processing_time_ms INTEGER DEFAULT 0,
            store_b1_count INTEGER DEFAULT 0,
            store_b2_count INTEGER DEFAULT 0,
            store_b3_count INTEGER DEFAULT 0,
            store_ld_count INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(date)
        )
    `);

    // Create indexes
    try {
        db.run(`CREATE INDEX IF NOT EXISTS idx_ps_submission ON pilot_submissions(submission_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_ps_store ON pilot_submissions(store_code, created_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_ps_writer ON pilot_submissions(writer_name, store_code)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_wmp_submission ON pilot_writer_memory_proof(submission_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_wmp_field ON pilot_writer_memory_proof(store_code, field_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_pal_submission ON pilot_alert_log(submission_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_pal_store ON pilot_alert_log(store_code)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_pmrr_store ON pilot_manager_routing(store_code)`);
    } catch (_) { /* already exists */ }

    db.saveDb();
    logger.info("[PILOT] Tables initialized");
}

// ─── Submission Recording ─────────────────────────────────────────────

/**
 * Record a pilot submission. Call this for every form processed.
 */
function recordPilotSubmission(data) {
    const {
        submissionId,
        storeCode,
        storeName,
        writerName,
        employeePhone,
        templateId,
        selectedColumn,
        imageQualityScore,
        ocrConfidence,
        memoryUsed,
        writerMemoryUsed,
        writerSampleCount,
        predictionUsed,
        crossFieldDetected,
        manualEditUsed,
        managerReviewUsed,
        retakeRequired,
        retakeReason,
        finalStatus,
        processingTimeMs,
        alertSent,
        alertType,
        alertBlocked,
    } = data;

    // Check if already exists (dedup)
    const existing = db.getOne(`SELECT id FROM pilot_submissions WHERE submission_id = ?`, [submissionId]);
    if (existing) {
        logger.warn("[PILOT] Duplicate submission ignored", { submissionId });
        return;
    }

    db.run(
        `INSERT INTO pilot_submissions
           (submission_id, store_code, store_name, writer_name, employee_phone,
            template_id, selected_column, image_quality_score, ocr_confidence,
            memory_used, writer_memory_used, writer_sample_count, prediction_used,
            cross_field_detected, manual_edit_used, manager_review_used,
            retake_required, retake_reason, final_status, processing_time_ms,
            alert_sent, alert_type, alert_blocked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            submissionId, storeCode, storeName || null, writerName || null,
            employeePhone || null, templateId || null, selectedColumn || null,
            imageQualityScore || 0, ocrConfidence || 0,
            memoryUsed ? 1 : 0, writerMemoryUsed ? 1 : 0, writerSampleCount || 0,
            predictionUsed ? 1 : 0, crossFieldDetected ? 1 : 0,
            manualEditUsed ? 1 : 0, managerReviewUsed ? 1 : 0,
            retakeRequired ? 1 : 0, retakeReason || null,
            finalStatus || "PENDING", processingTimeMs || 0,
            alertSent ? 1 : 0, alertType || null, alertBlocked ? 1 : 0,
        ]
    );
    db.saveDb();

    logger.info("[PILOT] Submission recorded", {
        submissionId, storeCode, finalStatus, retakeRequired,
        memoryUsed, writerMemoryUsed, predictionUsed,
    });
}

/**
 * Update submission when it reaches a final status.
 */
function updatePilotSubmissionStatus(submissionId, finalStatus, confirmedAt) {
    db.run(
        `UPDATE pilot_submissions SET final_status = ?, confirmed_at = ? WHERE submission_id = ?`,
        [finalStatus, confirmedAt || new Date().toISOString(), submissionId]
    );
    db.saveDb();
}

/**
 * Record field-level writer memory proof. Call this for every field in a submission.
 */
function recordWriterMemoryProof(data) {
    const {
        submissionId,
        storeCode,
        fieldId,
        columnLabel,
        ocrRawValue,
        ocrConfidence,
        memoryValue,
        writerProfileValue,
        writerSampleCount,
        predictedValue,
        predictionSource,
        predictionConfidence,
        finalValue,
        wasEdited,
        wasConfirmed,
    } = data;

    db.run(
        `INSERT INTO pilot_writer_memory_proof
           (submission_id, store_code, field_id, column_label,
            ocr_raw_value, ocr_confidence, memory_value, writer_profile_value,
            writer_sample_count, predicted_value, prediction_source, prediction_confidence,
            final_value, was_edited, was_confirmed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            submissionId, storeCode, fieldId, columnLabel || null,
            ocrRawValue !== undefined ? String(ocrRawValue) : null,
            ocrConfidence || 0,
            memoryValue !== undefined ? String(memoryValue) : null,
            writerProfileValue !== undefined ? String(writerProfileValue) : null,
            writerSampleCount || 0,
            predictedValue !== undefined ? String(predictedValue) : null,
            predictionSource || null,
            predictionConfidence || 0,
            finalValue !== undefined ? String(finalValue) : null,
            wasEdited ? 1 : 0,
            wasConfirmed ? 1 : 0,
        ]
    );
    db.saveDb();
}

/**
 * Record ground truth for field accuracy validation.
 */
function recordGroundTruth(data) {
    const { submissionId, storeCode, fieldId, columnLabel, groundTruthValue, ocrValue, memoryValue, writerMemoryValue, finalValue } = data;
    db.run(
        `INSERT INTO pilot_field_accuracy
           (submission_id, store_code, field_id, column_label, ground_truth_value, ocr_value, memory_value, writer_memory_value, final_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            submissionId, storeCode, fieldId, columnLabel || null,
            String(groundTruthValue),
            ocrValue ? String(ocrValue) : null,
            memoryValue ? String(memoryValue) : null,
            writerMemoryValue ? String(writerMemoryValue) : null,
            finalValue ? String(finalValue) : null,
        ]
    );
    db.saveDb();
}

/**
 * Record an alert event for alert quality KPI.
 */
function recordAlert(data) {
    const { submissionId, storeCode, alertType, alertCategory, isTrueAlert, isFalseAlert, isBlocked, blockedReason, escalatedTo, managerName } = data;
    db.run(
        `INSERT INTO pilot_alert_log
           (submission_id, store_code, alert_type, alert_category, is_true_alert, is_false_alert, is_blocked, blocked_reason, escalated_to, manager_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            submissionId, storeCode, alertType || "UNSAFE_TEMPERATURE",
            alertCategory || "UNSAFE_TEMPERATURE",
            isTrueAlert ? 1 : 0, isFalseAlert ? 1 : 0, isBlocked ? 1 : 0,
            blockedReason || null, escalatedTo || null, managerName || null,
        ]
    );
    db.saveDb();
}

/**
 * Record manager routing validation.
 */
function recordManagerRouting(data) {
    const { submissionId, storeCode, expectedManager, actualManager, routingCorrect, crossStoreEscalation } = data;
    db.run(
        `INSERT INTO pilot_manager_routing
           (submission_id, store_code, expected_manager, actual_manager, routing_correct, cross_store_escalation)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [submissionId, storeCode, expectedManager, actualManager || null, routingCorrect ? 1 : 0, crossStoreEscalation ? 1 : 0]
    );
    db.saveDb();
}

// ─── KPI Query Functions ───────────────────────────────────────────────

/**
 * Phase 2: Get Successful Capture Rate KPI
 */
function getCaptureRateKPI(startDate, endDate) {
    const wc = [];
    const params = [];
    if (startDate) { wc.push("created_at >= ?"); params.push(startDate); }
    if (endDate) { wc.push("created_at <= ?"); params.push(endDate); }
    const where = wc.length > 0 ? `WHERE ${wc.join(" AND ")}` : "";
    const row = db.getOne(
        `SELECT COUNT(*) as total,
            SUM(CASE WHEN final_status IN ('CONFIRMED','AUTO_CONFIRMED') THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN final_status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN final_status = 'MANAGER_REVIEW' THEN 1 ELSE 0 END) as manager_review,
            SUM(CASE WHEN retake_required = 1 THEN 1 ELSE 0 END) as retaken,
            AVG(processing_time_ms) as avg_time
         FROM pilot_submissions ${where}`, params
    );
    const total = row ? (row.total || 0) : 0;
    const completed = row ? (row.completed || 0) : 0;
    const retaken = row ? (row.retaken || 0) : 0;
    const rate = (num, den) => den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
    return {
        totalSubmitted: total,
        totalCompleted: completed,
        totalCancelled: row ? (row.cancelled || 0) : 0,
        totalManagerReview: row ? (row.manager_review || 0) : 0,
        totalRetaken: retaken,
        successfulCaptureRate: rate(completed, total),
        retakeRate: rate(retaken, total),
        avgProcessingTimeMs: row && row.avg_time ? Math.round(row.avg_time) : 0,
        target: { captureRate: 95, retakeRate: 5 },
    };
}

/**
 * Phase 3: Get Retake KPI with reasons
 */
function getRetakeKPI(startDate, endDate) {
    const wc = [];
    const params = [];
    if (startDate) { wc.push("created_at >= ?"); params.push(startDate); }
    if (endDate) { wc.push("created_at <= ?"); params.push(endDate); }
    const where = wc.length > 0 ? `WHERE ${wc.join(" AND ")}` : "";
    const total = db.getOne(`SELECT COUNT(*) as cnt FROM pilot_submissions ${where}`, params);
    const retakes = db.getAll(
        `SELECT retake_reason, COUNT(*) as count
         FROM pilot_submissions ${where ? where + " AND retake_required = 1" : "WHERE retake_required = 1"}
         GROUP BY retake_reason ORDER BY count DESC`, params
    );
    const retakeCount = retakes.reduce((sum, r) => sum + r.count, 0);
    const rate = total && total.cnt > 0 ? Math.round((retakeCount / total.cnt) * 1000) / 10 : 0;
    return {
        retakeCount,
        retakePercentage: rate,
        target: "<5%",
        passing: rate <= 5,
        reasons: retakes.map(r => ({ reason: r.retake_reason || "UNKNOWN", count: r.count })),
    };
}

/**
 * Phase 4: Get Writer Memory Proof — shows OCR vs Memory vs Writer vs Final for every field
 */
function getWriterMemoryProof(storeCode, limit = 50) {
    return db.getAll(
        `SELECT submission_id, store_code, field_id, column_label,
            ocr_raw_value, ocr_confidence,
            memory_value, writer_profile_value, writer_sample_count,
            predicted_value, prediction_source, prediction_confidence,
            final_value, was_edited, was_confirmed
         FROM pilot_writer_memory_proof
         WHERE store_code = ? AND prediction_source IS NOT NULL
         ORDER BY created_at DESC LIMIT ?`, [storeCode, limit]
    ).map(r => ({
        submissionId: r.submission_id,
        storeCode: r.store_code,
        fieldId: r.field_id,
        column: r.column_label,
        ocrValue: r.ocr_raw_value,
        memoryValue: r.memory_value,
        writerValue: r.writer_profile_value,
        writerSampleCount: r.writer_sample_count,
        predictedValue: r.predicted_value,
        source: r.prediction_source,
        finalValue: r.final_value,
        wasEdited: !!r.was_edited,
        wasConfirmed: !!r.was_confirmed,
    }));
}

/**
 * Phase 5: Get Field Accuracy KPI (requires ground truth to be recorded)
 */
function getFieldAccuracyKPI(startDate, endDate, storeCode) {
    const wc = ["ground_truth_value IS NOT NULL"];
    const params = [];
    if (startDate) { wc.push("p.created_at >= ?"); params.push(startDate); }
    if (endDate) { wc.push("p.created_at <= ?"); params.push(endDate); }
    if (storeCode) { wc.push("p.store_code = ?"); params.push(storeCode); }
    const where = `WHERE ${wc.join(" AND ")}`;

    const rows = db.getAll(
        `SELECT p.submission_id, p.field_id, p.ground_truth_value, p.ocr_value, p.memory_value, p.writer_memory_value, p.final_value
         FROM pilot_field_accuracy p ${where} LIMIT 500`, params
    );

    let rawCorrect = 0, memCorrect = 0, writerCorrect = 0, finalCorrect = 0, total = 0;
    for (const r of rows) {
        const gt = String(r.ground_truth_value).trim();
        const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
        const gtNum = toNum(gt);
        if (gtNum === null) continue;
        total++;
        if (toNum(r.ocr_value) !== null && Math.abs(toNum(r.ocr_value) - gtNum) <= 1) rawCorrect++;
        if (toNum(r.memory_value) !== null && Math.abs(toNum(r.memory_value) - gtNum) <= 1) memCorrect++;
        if (toNum(r.writer_memory_value) !== null && Math.abs(toNum(r.writer_memory_value) - gtNum) <= 1) writerCorrect++;
        if (toNum(r.final_value) !== null && Math.abs(toNum(r.final_value) - gtNum) <= 1) finalCorrect++;
    }
    const rate = n => total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
    return {
        totalFieldsVerified: total,
        rawOcrAccuracy: rate(rawCorrect),
        memoryAccuracy: rate(memCorrect),
        writerMemoryAccuracy: rate(writerCorrect),
        finalAccuracy: rate(finalCorrect),
        rawOcrTarget: ">=70%",
        finalTarget: ">=90%",
    };
}

/**
 * Phase 6: Get Alert Quality KPI
 */
function getAlertQualityKPI(startDate, endDate) {
    const wc = [];
    const params = [];
    if (startDate) { wc.push("created_at >= ?"); params.push(startDate); }
    if (endDate) { wc.push("created_at <= ?"); params.push(endDate); }
    const where = wc.length > 0 ? `WHERE ${wc.join(" AND ")}` : "";
    const row = db.getOne(
        `SELECT COUNT(*) as total,
            SUM(is_true_alert) as true_count,
            SUM(is_false_alert) as false_count,
            SUM(is_blocked) as blocked_count
         FROM pilot_alert_log ${where}`, params
    );
    const total = row ? (row.total || 0) : 0;
    const trueCount = row ? (row.true_count || 0) : 0;
    const falseCount = row ? (row.false_count || 0) : 0;
    const blockedCount = row ? (row.blocked_count || 0) : 0;
    return {
        totalAlerts: total,
        trueAlerts: trueCount,
        falseAlerts: falseCount,
        blockedAlerts: blockedCount,
        falseAlertTarget: 0,
        passing: falseCount === 0,
    };
}

/**
 * Phase 7: Get Management Routing Validation
 */
function getManagerRoutingValidation() {
    const rows = db.getAll(
        `SELECT store_code, expected_manager, actual_manager, routing_correct, cross_store_escalation, COUNT(*) as count
         FROM pilot_manager_routing GROUP BY store_code, expected_manager, actual_manager`
    );
    const correct = rows.filter(r => r.routing_correct).reduce((sum, r) => sum + r.count, 0);
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return {
        totalRoutings: total,
        correctRoutings: correct,
        accuracy: total > 0 ? Math.round((correct / total) * 1000) / 10 : 0,
        byStore: rows.map(r => ({
            store: r.store_code,
            expected: r.expected_manager,
            actual: r.actual_manager,
            correct: !!r.routing_correct,
            crossStore: !!r.cross_store_escalation,
            count: r.count,
        })),
    };
}

/**
 * Phase 8: One Image One Reply Validation
 */
function getOneImageOneReplyKPI() {
    // Check for duplicate message_ids with multiple replies
    const rows = db.getAll(
        `SELECT message_id, COUNT(*) as reply_count
         FROM food_safety_message_log
         WHERE direction = 'out' AND message_id IS NOT NULL
         GROUP BY message_id HAVING COUNT(*) > 1`
    );
    const duplicates = rows.length;
    return {
        duplicateReplyGroups: duplicates,
        passing: duplicates === 0,
        details: rows.slice(0, 10).map(r => ({ messageId: r.message_id, replyCount: r.reply_count })),
    };
}

/**
 * Build the full pilot dashboard message for management.
 */
function buildPilotDashboard(startDate, endDate) {
    const capture = getCaptureRateKPI(startDate, endDate);
    const retake = getRetakeKPI(startDate, endDate);
    const alert = getAlertQualityKPI(startDate, endDate);
    const routing = getManagerRoutingValidation();
    const oir = getOneImageOneReplyKPI();
    const stores = ["B1", "B2", "B3"];
    const storeStats = stores.map(store => getCaptureRateKPI(startDate, endDate));

    const lines = [
        "========================================",
        "  FOOD SAFETY BOT - 100 FORM PILOT",
        "  LIVE DASHBOARD",
        "========================================",
        "",
        "Period: " + (startDate || "All time") + " to " + (endDate || "Now"),
        "",
        "== PHASE 2: CAPTURE RATE ==",
        "Submitted: " + capture.totalSubmitted + "  |  Completed: " + capture.totalCompleted,
        "Capture Rate: " + capture.successfulCaptureRate + "%  (Target >=95%)  " + (capture.successfulCaptureRate >= 95 ? "PASS" : "FAIL"),
        "",
        "== PHASE 3: RETAKE KPI ==",
        "Retaken: " + retake.retakeCount + "  |  Rate: " + retake.retakePercentage + "%  (Target <5%)  " + (retake.passing ? "PASS" : "FAIL"),
    ];

    if (retake.reasons && retake.reasons.length > 0) {
        lines.push("Retake reasons:");
        for (const r of retake.reasons) {
            lines.push("  " + r.reason + ": " + r.count);
        }
    }

    lines.push("");
    lines.push("== PHASE 6: ALERT QUALITY ==");
    lines.push("Total: " + alert.totalAlerts + "  |  True: " + alert.trueAlerts + "  |  False: " + alert.falseAlerts + "  |  Blocked: " + alert.blockedAlerts);
    lines.push("False Alert Target: " + alert.falseAlertTarget + "  " + (alert.passing ? "PASS" : "FAIL"));

    lines.push("");
    lines.push("== PHASE 8: ONE IMAGE ONE REPLY ==");
    lines.push("Duplicate reply groups: " + oir.duplicateReplyGroups + "  " + (oir.passing ? "PASS" : "FAIL"));

    lines.push("");
    lines.push("== PHASE 7: MANAGER ROUTING ==");
    lines.push("Routing Accuracy: " + routing.accuracy + "%  |  Correct: " + routing.correctRoutings + "/" + routing.totalRoutings);
    if (routing.byStore) {
        for (const r of routing.byStore) {
            lines.push("  " + r.store + ": expected=" + r.expected + ", actual=" + (r.actual || "?") + "  " + (r.correct ? "CORRECT" : "WRONG") + (r.crossStore ? "  CROSS-STORE" : ""));
        }
    }

    lines.push("");
    lines.push("== PHASE 4: WRITER MEMORY PROOF ==");
    lines.push("See: getWriterMemoryProof() for per-field evidence");
    lines.push("Required: OCR vs Memory vs Writer vs Final per field");

    lines.push("");
    lines.push("== PHASE 5: FIELD ACCURACY ==");
    const accuracy = getFieldAccuracyKPI(startDate, endDate, null);
    if (accuracy.totalFieldsVerified > 0) {
        lines.push("Fields verified: " + accuracy.totalFieldsVerified);
        lines.push("Raw OCR Accuracy: " + accuracy.rawOcrAccuracy + "%  (Target >=70%)  " + (accuracy.rawOcrAccuracy >= 70 ? "PASS" : "FAIL"));
        lines.push("Final Accuracy: " + accuracy.finalAccuracy + "%  (Target >=90%)  " + (accuracy.finalAccuracy >= 90 ? "PASS" : "FAIL"));
        lines.push("Writer Memory Accuracy: " + accuracy.writerMemoryAccuracy + "%");
    } else {
        lines.push("No ground truth recorded yet. Target: 10 forms per store.");
    }

    // GO/NO-GO
    const goLivePassing =
        capture.successfulCaptureRate >= 95 &&
        retake.retakePercentage <= 5 &&
        (accuracy.totalFieldsVerified === 0 || accuracy.finalAccuracy >= 90) &&
        alert.falseAlerts === 0;

    lines.push("");
    lines.push("========================================");
    lines.push("GO LIVE DECISION: " + (goLivePassing ? "PASS" : "NOT YET"));
    lines.push("========================================");

    return lines.join("\n");
}

// ─── CEO Certification Report Generator ──────────────────────────────

function generateCEOReport(startDate, endDate) {
    const capture = getCaptureRateKPI(startDate, endDate);
    const retake = getRetakeKPI(startDate, endDate);
    const alert = getAlertQualityKPI(startDate, endDate);
    const routing = getManagerRoutingValidation();
    const accuracy = getFieldAccuracyKPI(startDate, endDate, null);

    const allStores = db.getAll(
        `SELECT store_code, COUNT(*) as count FROM pilot_submissions GROUP BY store_code`
    );

    const goLiveCriteria = {
        captureRate: { value: capture.successfulCaptureRate, target: 95, passing: capture.successfulCaptureRate >= 95 },
        retakeRate: { value: retake.retakePercentage, target: 5, passing: retake.retakePercentage <= 5 },
        finalAccuracy: { value: accuracy.totalFieldsVerified > 0 ? accuracy.finalAccuracy : null, target: 90, passing: accuracy.totalFieldsVerified === 0 || accuracy.finalAccuracy >= 90 },
        falseAlerts: { value: alert.falseAlerts, target: 0, passing: alert.falseAlerts === 0 },
    };

    const overallPass = Object.values(goLiveCriteria).every(c => c.passing);
    const sampleSize = capture.totalSubmitted;

    return {
        sampleSize,
        targetSample: 100,
        sampleComplete: sampleSize >= 100,
        byStore: allStores.map(r => ({ store: r.store_code, count: r.count })),
        criteria: goLiveCriteria,
        overallPass,
        reportGeneratedAt: new Date().toISOString(),
    };
}

module.exports = {
    initPilotTables,
    recordPilotSubmission,
    updatePilotSubmissionStatus,
    recordWriterMemoryProof,
    recordGroundTruth,
    recordAlert,
    recordManagerRouting,
    getCaptureRateKPI,
    getRetakeKPI,
    getWriterMemoryProof,
    getFieldAccuracyKPI,
    getAlertQualityKPI,
    getManagerRoutingValidation,
    getOneImageOneReplyKPI,
    buildPilotDashboard,
    generateCEOReport,
    PILOT_CONFIG,
};
