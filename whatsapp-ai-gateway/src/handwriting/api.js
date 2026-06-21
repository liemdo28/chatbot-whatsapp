/**
 * api.js — Phase 12: Handwriting Memory Dashboard / API
 * 
 * REST API endpoints for the handwriting memory system.
 * Mounted at /api/handwriting/*
 */

const logger = require("../logger");
const db = require("../database");
const confirmedSamples = require("./confirmedSamples");
const cellCropStorage = require("./cellCropStorage");
const sampleImporter = require("./sampleImporter");
const { searchMemory } = require("./memorySearch");
const { predictFormValues } = require("./predictionEngine");
const { initHandwritingTables } = require("./dbSchema");

/**
 * Register all handwriting API routes on an Express app
 */
function registerHandwritingRoutes(app) {
    // Initialize DB tables on startup
    try {
        initHandwritingTables();
        logger.info("Handwriting memory DB tables initialized");
    } catch (err) {
        logger.error("Handwriting DB init failed", { error: err.message });
    }

    // ─── GET /api/handwriting/status ────────────────────────────────
    app.get("/api/handwriting/status", (req, res) => {
        try {
            const totalCrops = cellCropStorage.getTotalCropCount();
            const cropsByStore = cellCropStorage.getCropCountByStore();
            const totalSamples = confirmedSamples.getTotalSampleCount();
            const samplesByStore = confirmedSamples.getSampleCountByStore();
            const samplesByEmployee = confirmedSamples.getSampleCountByEmployee();
            const samplesBySource = confirmedSamples.getSampleCountBySource();

            // Accuracy metrics
            const accuracyBefore = getAccuracyMetrics("before_memory");
            const accuracyAfter = getAccuracyMetrics("after_memory");

            // Recent activity
            const recentEdits = db.getAll(
                `SELECT * FROM handwriting_confirmed_samples
                 WHERE source_action = 'EDIT'
                 ORDER BY created_at DESC LIMIT 10`
            );

            // Low confidence fields
            const lowConfidence = db.getAll(
                `SELECT field_id, store_code, COUNT(*) as count
                 FROM handwriting_confirmed_samples
                 WHERE source_action IN ('EDIT', 'MANUAL')
                 GROUP BY field_id, store_code
                 ORDER BY count DESC LIMIT 10`
            );

            res.json({
                ok: true,
                total_crops: totalCrops,
                crops_by_store: cropsByStore,
                total_samples: totalSamples,
                samples_by_store: samplesByStore,
                samples_by_employee: samplesByEmployee,
                samples_by_source: samplesBySource,
                accuracy_before_memory: accuracyBefore,
                accuracy_after_memory: accuracyAfter,
                recent_edits: recentEdits,
                most_corrected_fields: lowConfidence,
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            logger.error("Handwriting status error", { error: err.message });
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── GET /api/handwriting/samples ───────────────────────────────
    app.get("/api/handwriting/samples", (req, res) => {
        try {
            const samples = confirmedSamples.getSamples({
                store_code: req.query.store,
                field_id: req.query.field,
                employee_name: req.query.employee,
                limit: parseInt(req.query.limit) || 50,
            });
            res.json({ ok: true, samples, count: samples.length });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── GET /api/handwriting/samples/:id ───────────────────────────
    app.get("/api/handwriting/samples/:id", (req, res) => {
        try {
            const sample = confirmedSamples.getSampleById(req.params.id);
            if (!sample) return res.status(404).json({ ok: false, error: "Not found" });
            res.json({ ok: true, sample });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── POST /api/handwriting/import-sample ────────────────────────
    app.post("/api/handwriting/import-sample", async (req, res) => {
        try {
            const result = await sampleImporter.importSample(req.body);
            res.json(result);
        } catch (err) {
            logger.error("Import sample error", { error: err.message });
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── POST /api/handwriting/import-form ──────────────────────────
    app.post("/api/handwriting/import-form", async (req, res) => {
        try {
            const result = await sampleImporter.importForm(req.body);
            res.json(result);
        } catch (err) {
            logger.error("Import form error", { error: err.message });
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── POST /api/handwriting/rebuild-index ────────────────────────
    app.post("/api/handwriting/rebuild-index", (req, res) => {
        try {
            // Re-initialize tables (creates indexes if not exist)
            initHandwritingTables();
            res.json({ ok: true, message: "Index rebuilt" });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── GET /api/handwriting/predictions/:submission_id ────────────
    app.get("/api/handwriting/predictions/:submission_id", (req, res) => {
        try {
            const predictions = db.getAll(
                `SELECT * FROM handwriting_predictions
                 WHERE submission_id = ?
                 ORDER BY field_id`,
                [parseInt(req.params.submission_id)]
            );
            res.json({ ok: true, predictions, count: predictions.length });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── POST /api/handwriting/search ───────────────────────────────
    app.post("/api/handwriting/search", async (req, res) => {
        try {
            const matches = await searchMemory(req.body);
            res.json({ ok: true, matches, count: matches.length });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── POST /api/handwriting/predict ──────────────────────────────
    app.post("/api/handwriting/predict", async (req, res) => {
        try {
            const result = await predictFormValues(req.body);
            res.json({ ok: true, ...result });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── GET /api/handwriting/crops ─────────────────────────────────
    app.get("/api/handwriting/crops", (req, res) => {
        try {
            let sql = "SELECT * FROM handwriting_cell_crops WHERE 1=1";
            const params = [];
            if (req.query.store) { sql += " AND store_code = ?"; params.push(req.query.store); }
            if (req.query.field) { sql += " AND field_id = ?"; params.push(req.query.field); }
            sql += " ORDER BY created_at DESC";
            if (req.query.limit) { sql += " LIMIT ?"; params.push(parseInt(req.query.limit)); }
            else { sql += " LIMIT 50"; }
            const crops = db.getAll(sql, params);
            res.json({ ok: true, crops, count: crops.length });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── GET /api/handwriting/accuracy ──────────────────────────────
    app.get("/api/handwriting/accuracy", (req, res) => {
        try {
            const overall = db.getAll(
                `SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN ocr_correct = 1 THEN 1 ELSE 0 END) as ocr_correct_count,
                    SUM(CASE WHEN prediction_correct = 1 THEN 1 ELSE 0 END) as prediction_correct_count
                 FROM handwriting_accuracy_log`
            );

            const byStore = db.getAll(
                `SELECT
                    store_code,
                    COUNT(*) as total,
                    SUM(CASE WHEN ocr_correct = 1 THEN 1 ELSE 0 END) as ocr_correct,
                    SUM(CASE WHEN prediction_correct = 1 THEN 1 ELSE 0 END) as prediction_correct
                 FROM handwriting_accuracy_log
                 GROUP BY store_code`
            );

            const byField = db.getAll(
                `SELECT
                    field_id,
                    store_code,
                    COUNT(*) as total,
                    SUM(CASE WHEN ocr_correct = 1 THEN 1 ELSE 0 END) as ocr_correct,
                    SUM(CASE WHEN prediction_correct = 1 THEN 1 ELSE 0 END) as prediction_correct
                 FROM handwriting_accuracy_log
                 GROUP BY field_id, store_code
                 ORDER BY total DESC
                 LIMIT 20`
            );

            res.json({
                ok: true,
                overall: overall[0] || { total: 0, ocr_correct_count: 0, prediction_correct_count: 0 },
                by_store: byStore,
                by_field: byField,
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    logger.info("Handwriting API routes registered");
}

/**
 * Get accuracy metrics
 */
function getAccuracyMetrics(type) {
    try {
        const row = db.getOne(
            `SELECT
                COUNT(*) as total,
                SUM(CASE WHEN ocr_correct = 1 THEN 1 ELSE 0 END) as ocr_correct,
                SUM(CASE WHEN prediction_correct = 1 THEN 1 ELSE 0 END) as prediction_correct
             FROM handwriting_accuracy_log`
        );
        if (!row || row.total === 0) {
            return { total: 0, accuracy: 0, samples: 0 };
        }
        return {
            total: row.total,
            ocr_accuracy: row.total > 0 ? (row.ocr_correct / row.total * 100).toFixed(1) : 0,
            prediction_accuracy: row.total > 0 ? (row.prediction_correct / row.total * 100).toFixed(1) : 0,
            samples: row.total,
        };
    } catch (err) {
        return { total: 0, accuracy: 0, samples: 0 };
    }
}

module.exports = {
    registerHandwritingRoutes,
    getAccuracyMetrics,
};
