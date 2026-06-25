/**
 * GBP API — REST Endpoints
 *
 * Mounts the 5 required endpoints on the existing Express app:
 *   GET /api/gbp/locations
 *   GET /api/gbp/performance
 *   GET /api/gbp/reviews
 *   GET /api/gbp/calls
 *   GET /api/gbp/directions
 *
 * Plus operational endpoints:
 *   GET /api/gbp/health
 *   GET /api/gbp/connection-test
 *   POST /api/gbp/sync
 *   GET /api/gbp/snapshots
 *   GET /api/gbp/dashboard
 *
 * No mock data — all endpoints hit live Google API or stored snapshots.
 */

const express = require("express");
const logger = require("../logger");
const gbpService = require("./gbp-service");
const gbpDb = require("./gbp-database");
const gbpSync = require("./gbp-sync");
const gbpClient = require("./gbp-client");

/**
 * Register all GBP routes on the given Express app.
 */
function registerGbpRoutes(app) {
    const router = express.Router();

    // ─── Required Endpoints ──────────────────────────────────────────────

    // GET /api/gbp/locations
    router.get("/locations", async (req, res) => {
        try {
            const result = await gbpService.getLocations();
            res.json(result);
        } catch (err) {
            logger.error("GBP /locations failed", { error: err.message });
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // GET /api/gbp/performance?start=YYYY-MM-DD&end=YYYY-MM-DD
    router.get("/performance", async (req, res) => {
        try {
            const startDate = req.query.start;
            const endDate = req.query.end;
            const result = await gbpService.getPerformance(startDate, endDate);
            res.json(result);
        } catch (err) {
            logger.error("GBP /performance failed", { error: err.message });
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // GET /api/gbp/reviews
    router.get("/reviews", async (req, res) => {
        try {
            const result = await gbpService.getReviews();
            res.json(result);
        } catch (err) {
            logger.error("GBP /reviews failed", { error: err.message });
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // GET /api/gbp/calls?start=YYYY-MM-DD&end=YYYY-MM-DD
    router.get("/calls", async (req, res) => {
        try {
            const startDate = req.query.start;
            const endDate = req.query.end;
            const result = await gbpService.getCalls(startDate, endDate);
            res.json(result);
        } catch (err) {
            logger.error("GBP /calls failed", { error: err.message });
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // GET /api/gbp/directions?start=YYYY-MM-DD&end=YYYY-MM-DD
    router.get("/directions", async (req, res) => {
        try {
            const startDate = req.query.start;
            const endDate = req.query.end;
            const result = await gbpService.getDirections(startDate, endDate);
            res.json(result);
        } catch (err) {
            logger.error("GBP /directions failed", { error: err.message });
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ─── Operational Endpoints ───────────────────────────────────────────

    // GET /api/gbp/health
    router.get("/health", async (req, res) => {
        try {
            const health = await gbpService.healthCheck();
            res.json(health);
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // GET /api/gbp/connection-test
    router.get("/connection-test", async (req, res) => {
        try {
            const result = await gbpClient.testConnection();
            res.json(result);
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // POST /api/gbp/sync - trigger a full sync
    router.post("/sync", async (req, res) => {
        try {
            logger.info("GBP: Sync triggered via API");
            const result = await gbpService.runSync();
            res.json(result);
        } catch (err) {
            logger.error("GBP /sync failed", { error: err.message });
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // GET /api/gbp/snapshots - list stored snapshots
    router.get("/snapshots", async (req, res) => {
        try {
            const limit = parseInt(req.query.limit, 10) || 30;
            const logs = gbpDb.getSyncLogs(limit);
            res.json({ ok: true, count: logs.length, snapshots: logs });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // GET /api/gbp/dashboard - aggregated dashboard view
    router.get("/dashboard", async (req, res) => {
        try {
            const startDate = req.query.start;
            const endDate = req.query.end;
            const range = gbpSync.getDefaultDateRange();
            const start = startDate || range.startDate;
            const end = endDate || range.endDate;

            const [locations, performance, calls, directions, reviews] = await Promise.all([
                gbpService.getLocations(),
                gbpService.getPerformance(start, end),
                gbpService.getCalls(start, end),
                gbpService.getDirections(start, end),
                gbpService.getReviews(),
            ]);

            res.json({
                ok: true,
                dateRange: { startDate: start, endDate: end },
                locations,
                performance,
                calls,
                directions,
                reviews,
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            logger.error("GBP /dashboard failed", { error: err.message });
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // GET /api/gbp/stored-locations - read from local DB
    router.get("/stored-locations", async (req, res) => {
        try {
            const rows = gbpDb.getAllLocations();
            res.json({ ok: true, count: rows.length, locations: rows });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // GET /api/gbp/stored-reviews - read from local DB
    router.get("/stored-reviews", async (req, res) => {
        try {
            const locationId = req.query.location_id || null;
            const rows = gbpDb.getAllReviews(locationId);
            res.json({ ok: true, count: rows.length, reviews: rows });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.use("/api/gbp", router);

    logger.info("GBP API routes registered");
}

module.exports = {
    registerGbpRoutes,
};