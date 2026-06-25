/**
 * GBP Service — Business Logic Layer
 *
 * High-level methods consumed by the REST endpoints.
 * Wraps gbp-client (raw API) and gbp-database (local storage)
 * to provide formatted responses for Dashboard, n8n, and CEO Control Center.
 *
 * No mock data — every call returns real API results or a real error.
 */

const logger = require("../logger");
const gbpClient = require("./gbp-client");
const gbpDb = require("./gbp-database");
const gbpSync = require("./gbp-sync");

/**
 * Get all managed locations.
 * Returns real data from Google Business Profile API.
 */
async function getLocations() {
    try {
        const data = await gbpClient.getLocations();
        return {
            ok: true,
            accountCount: data.accounts.length,
            accounts: data.accounts.map((a) => ({
                name: a.name,
                displayName: a.displayName,
            })),
            locationCount: data.locations.length,
            locations: data.locations.map((l) => ({
                locationId: l.locationId,
                locationName: l.locationName,
                title: l.title,
                address: l.address,
                phone: l.phone,
                website: l.website,
                categories: l.categories,
                metadata: l.metadata,
                regularHours: l.regularHours,
            })),
            timestamp: new Date().toISOString(),
            source: "GOOGLE_BUSINESS_PROFILE_API",
        };
    } catch (err) {
        logger.error("GBP Service: getLocations failed", { error: err.message });
        return {
            ok: false,
            error: err.message,
            timestamp: new Date().toISOString(),
            source: "GOOGLE_BUSINESS_PROFILE_API",
        };
    }
}

/**
 * Get performance metrics for all locations.
 * Returns real calls, directions, website clicks, impressions.
 */
async function getPerformance(startDate, endDate) {
    if (!startDate || !endDate) {
        const range = gbpSync.getDefaultDateRange();
        startDate = startDate || range.startDate;
        endDate = endDate || range.endDate;
    }

    try {
        const locationsData = await gbpClient.getLocations();
        const results = [];

        for (const loc of locationsData.locations) {
            try {
                const perf = await gbpClient.getPerformance(loc.locationName, startDate, endDate);
                const metrics = extractMetrics(perf);
                results.push({
                    locationId: loc.locationId,
                    title: loc.title,
                    locationName: loc.locationName,
                    metrics,
                    status: "OK",
                });
            } catch (err) {
                results.push({
                    locationId: loc.locationId,
                    title: loc.title,
                    locationName: loc.locationName,
                    status: "ERROR",
                    error: err.message,
                });
            }
        }

        return {
            ok: true,
            dateRange: { startDate, endDate },
            locationCount: results.length,
            results,
            timestamp: new Date().toISOString(),
            source: "GOOGLE_BUSINESS_PROFILE_PERFORMANCE_API",
        };
    } catch (err) {
        logger.error("GBP Service: getPerformance failed", { error: err.message });
        return {
            ok: false,
            error: err.message,
            timestamp: new Date().toISOString(),
            source: "GOOGLE_BUSINESS_PROFILE_PERFORMANCE_API",
        };
    }
}

/**
 * Get reviews for all locations.
 */
async function getReviews() {
    try {
        const locationsData = await gbpClient.getLocations();
        const results = [];

        for (const loc of locationsData.locations) {
            try {
                const reviews = await gbpClient.getReviews(loc.locationName);
                results.push({
                    locationId: loc.locationId,
                    title: loc.title,
                    locationName: loc.locationName,
                    reviewCount: reviews.length,
                    reviews: reviews.map((r) => ({
                        reviewId: r.name || r.reviewId,
                        author: r.author || r.reviewer?.displayName || "Anonymous",
                        rating: r.starRating || r.rating || 0,
                        comment: r.comment || r.text || "",
                        createTime: r.createTime || r.updateTime,
                        updateTime: r.updateTime || r.createTime,
                    })),
                    status: "OK",
                });
            } catch (err) {
                results.push({
                    locationId: loc.locationId,
                    title: loc.title,
                    status: "ERROR",
                    error: err.message,
                });
            }
        }

        return {
            ok: true,
            locationCount: results.length,
            results,
            timestamp: new Date().toISOString(),
            source: "GOOGLE_BUSINESS_PROFILE_API",
        };
    } catch (err) {
        logger.error("GBP Service: getReviews failed", { error: err.message });
        return {
            ok: false,
            error: err.message,
            timestamp: new Date().toISOString(),
            source: "GOOGLE_BUSINESS_PROFILE_API",
        };
    }
}

/**
 * Get call data for all locations.
 * Returns REAL call counts from the Performance API.
 */
async function getCalls(startDate, endDate) {
    if (!startDate || !endDate) {
        const range = gbpSync.getDefaultDateRange();
        startDate = startDate || range.startDate;
        endDate = endDate || range.endDate;
    }

    try {
        const locationsData = await gbpClient.getLocations();
        const results = [];

        for (const loc of locationsData.locations) {
            try {
                const calls = await gbpClient.getCalls(loc.locationName, startDate, endDate);
                const totalCalls = calls.reduce((sum, c) => sum + (c.calls || 0), 0);
                results.push({
                    locationId: loc.locationId,
                    title: loc.title,
                    locationName: loc.locationName,
                    totalCalls,
                    dailyBreakdown: calls,
                    status: "OK",
                });
            } catch (err) {
                results.push({
                    locationId: loc.locationId,
                    title: loc.title,
                    status: "ERROR",
                    error: err.message,
                });
            }
        }

        const grandTotal = results.reduce((sum, r) => sum + (r.totalCalls || 0), 0);
        return {
            ok: true,
            dateRange: { startDate, endDate },
            grandTotalCalls: grandTotal,
            locationCount: results.length,
            results,
            timestamp: new Date().toISOString(),
            source: "GOOGLE_BUSINESS_PROFILE_PERFORMANCE_API",
        };
    } catch (err) {
        return {
            ok: false,
            error: err.message,
            timestamp: new Date().toISOString(),
            source: "GOOGLE_BUSINESS_PROFILE_PERFORMANCE_API",
        };
    }
}

/**
 * Get direction requests for all locations.
 * Returns REAL direction data from the Performance API.
 */
async function getDirections(startDate, endDate) {
    if (!startDate || !endDate) {
        const range = gbpSync.getDefaultDateRange();
        startDate = startDate || range.startDate;
        endDate = endDate || range.endDate;
    }

    try {
        const locationsData = await gbpClient.getLocations();
        const results = [];

        for (const loc of locationsData.locations) {
            try {
                const dirs = await gbpClient.getDirections(loc.locationName, startDate, endDate);
                const totalDirections = dirs.reduce((sum, d) => sum + (d.directions || 0), 0);
                results.push({
                    locationId: loc.locationId,
                    title: loc.title,
                    locationName: loc.locationName,
                    totalDirections,
                    dailyBreakdown: dirs,
                    status: "OK",
                });
            } catch (err) {
                results.push({
                    locationId: loc.locationId,
                    title: loc.title,
                    status: "ERROR",
                    error: err.message,
                });
            }
        }

        const grandTotal = results.reduce((sum, r) => sum + (r.totalDirections || 0), 0);
        return {
            ok: true,
            dateRange: { startDate, endDate },
            grandTotalDirections: grandTotal,
            locationCount: results.length,
            results,
            timestamp: new Date().toISOString(),
            source: "GOOGLE_BUSINESS_PROFILE_PERFORMANCE_API",
        };
    } catch (err) {
        return {
            ok: false,
            error: err.message,
            timestamp: new Date().toISOString(),
            source: "GOOGLE_BUSINESS_PROFILE_PERFORMANCE_API",
        };
    }
}

/**
 * Run a full sync and store daily snapshots.
 */
async function runSync() {
    return await gbpSync.fullSync();
}

/**
 * Get stored snapshots from the database.
 */
function getStoredSnapshots(limit = 30) {
    return gbpDb.getSyncLogs(limit);
}

/**
 * Get stored performance data from DB.
 */
function getStoredPerformance(locationId, days = 30) {
    return gbpDb.getPerformanceSnapshots(locationId, days);
}

/**
 * Health check — returns connection status.
 */
async function healthCheck() {
    return await gbpClient.testConnection();
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractMetrics(perfData) {
    if (!perfData) return {};

    const metrics = {
        calls: 0,
        websiteClicks: 0,
        directionRequests: 0,
        impressionsDesktopMaps: 0,
        impressionsDesktopSearch: 0,
        impressionsMobileMaps: 0,
        impressionsMobileSearch: 0,
        totalImpressions: 0,
    };

    if (perfData.dailyMetricTimeSeries) {
        for (const series of perfData.dailyMetricTimeSeries) {
            const total = (series.timeSeries?.datedValues || []).reduce(
                (sum, v) => sum + parseInt(v.value || 0), 0
            );

            switch (series.dailyMetric) {
                case "CALLS": metrics.calls = total; break;
                case "WEBSITE_CLICKS": metrics.websiteClicks = total; break;
                case "BUSINESS_DIRECTION_REQUESTS": metrics.directionRequests = total; break;
                case "BUSINESS_IMPRESSIONS_DESKTOP_MAPS": metrics.impressionsDesktopMaps = total; break;
                case "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH": metrics.impressionsDesktopSearch = total; break;
                case "BUSINESS_IMPRESSIONS_MOBILE_MAPS": metrics.impressionsMobileMaps = total; break;
                case "BUSINESS_IMPRESSIONS_MOBILE_SEARCH": metrics.impressionsMobileSearch = total; break;
            }
        }
        metrics.totalImpressions =
            metrics.impressionsDesktopMaps +
            metrics.impressionsDesktopSearch +
            metrics.impressionsMobileMaps +
            metrics.impressionsMobileSearch;
    }

    return metrics;
}

module.exports = {
    getLocations,
    getPerformance,
    getReviews,
    getCalls,
    getDirections,
    runSync,
    getStoredSnapshots,
    getStoredPerformance,
    healthCheck,
};
