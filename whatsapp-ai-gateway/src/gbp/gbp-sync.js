/**
 * GBP Sync — Daily Snapshot Storage
 *
 * Pulls live data from Google Business Profile API and stores
 * daily snapshots in the local SQLite database (database/gbp/).
 *
 * Designed to run on a daily cron (or on-demand) to capture:
 *   - Location metadata
 *   - Performance metrics (calls, directions, website clicks)
 *   - Reviews
 *
 * All data is REAL — no mocks, no seeds.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../logger");
const gbpClient = require("./gbp-client");
const gbpDb = require("./gbp-database");

/**
 * Ensure the snapshot directory exists.
 */
function ensureSnapshotDir() {
    const dir = path.join(__dirname, "..", "..", "database", "gbp");
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info("GBP Sync: Created snapshot directory", { dir });
    }
    return dir;
}

/**
 * Compute date range (default: last 30 days).
 */
function getDefaultDateRange() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return {
        startDate: start.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
    };
}

/**
 * Full sync: locations, performance, reviews for all locations.
 */
async function fullSync() {
    const snapshotDir = ensureSnapshotDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { startDate, endDate } = getDefaultDateRange();

    logger.info("GBP Sync: Starting full sync", { startDate, endDate });

    // 1. Fetch all locations
    let locationsData;
    try {
        locationsData = await gbpClient.getLocations();
    } catch (err) {
        logger.error("GBP Sync: Failed to fetch locations", { error: err.message });
        return { status: "ERROR", error: err.message, step: "getLocations" };
    }

    const { accounts, locations } = locationsData;
    logger.info("GBP Sync: Locations fetched", { count: locations.length });

    // Store locations in DB
    for (const loc of locations) {
        gbpDb.upsertLocation(loc);
    }

    // 2. For each location, fetch performance + reviews
    const results = [];
    for (const loc of locations) {
        const locationName = loc.locationName;
        const locationResult = {
            locationId: loc.locationId,
            title: loc.title,
            locationName,
        };

        // Fetch performance metrics
        try {
            const perf = await gbpClient.getPerformance(locationName, startDate, endDate);
            locationResult.performance = perf;

            if (perf && perf.dailyMetricTimeSeries) {
                for (const series of perf.dailyMetricTimeSeries) {
                    const metricName = series.dailyMetric;
                    const timeSeries = series.timeSeries?.datedValues || [];

                    for (const point of timeSeries) {
                        gbpDb.insertPerformanceSnapshot({
                            locationId: loc.locationId,
                            date: point.date || point.startDate,
                            metric: metricName,
                            value: parseInt(point.value || 0),
                        });
                    }
                }
            }
        } catch (err) {
            logger.warn("GBP Sync: Performance fetch failed", { location: loc.title, error: err.message });
            locationResult.performanceError = err.message;
        }

        // Fetch reviews
        try {
            const reviews = await gbpClient.getReviews(locationName);
            locationResult.reviews = reviews;
            locationResult.reviewCount = reviews.length;

            for (const review of reviews) {
                gbpDb.upsertReview({
                    locationId: loc.locationId,
                    reviewId: review.name || review.reviewId || `unknown-${Date.now()}`,
                    authorName: review.author || review.reviewer?.displayName || "Anonymous",
                    rating: review.starRating || review.rating || 0,
                    comment: review.comment || review.text || "",
                    createTime: review.createTime || review.updateTime || new Date().toISOString(),
                    updateTime: review.updateTime || review.createTime || new Date().toISOString(),
                });
            }
        } catch (err) {
            logger.warn("GBP Sync: Reviews fetch failed", { location: loc.title, error: err.message });
            locationResult.reviewsError = err.message;
        }

        results.push(locationResult);
    }

    // 3. Write JSON snapshot
    const snapshot = {
        syncTimestamp: new Date().toISOString(),
        dateRange: { startDate, endDate },
        accountCount: accounts.length,
        locationCount: locations.length,
        results,
    };

    const snapshotPath = path.join(snapshotDir, `snapshot-${timestamp}.json`);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    logger.info("GBP Sync: Snapshot saved", { path: snapshotPath });

    // 4. Store sync metadata
    gbpDb.insertSyncLog({
        timestamp: new Date().toISOString(),
        locationCount: locations.length,
        snapshotPath,
        status: "SUCCESS",
    });

    return {
        status: "SUCCESS",
        locationCount: locations.length,
        snapshotPath,
        dateRange: { startDate, endDate },
        timestamp: new Date().toISOString(),
    };
}

/**
 * Quick sync — just fetch latest data without storing.
 * Used for on-demand API queries.
 */
async function quickSync(startDate, endDate) {
    if (!startDate || !endDate) {
        const range = getDefaultDateRange();
        startDate = startDate || range.startDate;
        endDate = endDate || range.endDate;
    }

    const locationsData = await gbpClient.getLocations();
    const results = [];

    for (const loc of locationsData.locations) {
        const locResult = { ...loc };

        try {
            const perf = await gbpClient.getPerformance(loc.locationName, startDate, endDate);
            locResult.performance = perf;
        } catch (err) {
            locResult.performanceError = err.message;
        }

        try {
            locResult.reviews = await gbpClient.getReviews(loc.locationName);
        } catch (err) {
            locResult.reviewsError = err.message;
        }

        results.push(locResult);
    }

    return { locations: results, dateRange: { startDate, endDate } };
}

module.exports = {
    fullSync,
    quickSync,
    getDefaultDateRange,
    ensureSnapshotDir,
};
