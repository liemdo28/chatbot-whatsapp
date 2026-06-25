/**
 * GBP Client — Google Business Profile API via REST endpoints.
 * Authenticates via service account. No mock data.
 */
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const logger = require("../logger");

const GBP_SCOPES = ["https://www.googleapis.com/auth/business.manage"];
const GBP_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
let _authClient = null;

function resolveCredentialPath() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const local = path.join(__dirname, "..", "..", "mi-gbp-service-account.json");
    if (fs.existsSync(local)) return local;
    const dev = String.raw`C:\Users\hoang\Downloads\source\mi-gbp-service-account.json`;
    if (fs.existsSync(dev)) return dev;
    return null;
}

async function initClient() {
    if (_authClient) return _authClient;
    const keyFile = resolveCredentialPath();
    if (!keyFile) throw new Error("GBP: No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS.");
    logger.info("GBP: Loading credentials", { path: keyFile });
    const key = JSON.parse(fs.readFileSync(keyFile, "utf-8"));
    const jwtClient = new google.auth.GoogleAuth({ credentials: key, scopes: GBP_SCOPES });
    _authClient = await jwtClient.getClient();
    logger.info("GBP: Auth client initialized");
    return _authClient;
}

async function getAuth() {
    if (!_authClient) await initClient();
    return _authClient;
}

async function getToken() {
    const auth = await getAuth();
    const resp = await auth.getAccessToken();
    return resp.token || resp;
}

async function gbpGet(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const token = await getToken();
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const text = await resp.text();
        if (resp.status === 429 && attempt < retries) {
            const waitMs = attempt * 5000;
            logger.warn("GBP: Rate limited, retrying", { attempt, waitMs });
            await new Promise(r => setTimeout(r, waitMs));
            continue;
        }
        if (!resp.ok) throw new Error(`GBP API ${resp.status}: ${text.slice(0, 300)}`);
        return JSON.parse(text);
    }
}

// ─── Locations ──────────────────────────────────────────────────────────────

async function getLocations() {
    const accountsData = await gbpGet(`${GBP_BASE}/accounts`);
    const accounts = accountsData.accounts || [];
    const allLocations = [];

    for (const account of accounts) {
        const accountId = account.name;
        const readMask = "name,title,storefrontAddress,websiteUri,phoneNumbers,categories,metadata,regularHours";
        const locsData = await gbpGet(`${accountId}/locations?readMask=${readMask}`);
        const locs = locsData.locations || [];
        for (const loc of locs) {
            allLocations.push({
                accountId,
                locationName: loc.name,
                locationId: loc.name.split("/").pop(),
                title: loc.title,
                address: loc.storefrontAddress,
                website: loc.websiteUri,
                phone: loc.phoneNumbers && loc.phoneNumbers.primaryPhone,
                categories: loc.categories,
                metadata: loc.metadata,
                regularHours: loc.regularHours,
                specialHours: loc.specialHours,
            });
        }
    }
    logger.info("GBP: Fetched locations", { count: allLocations.length });
    return { accounts, locations: allLocations };
}

async function getLocation(locationName) {
    return gbpGet(`${GBP_BASE}/${locationName}?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers,categories`);
}

// ─── Reviews ────────────────────────────────────────────────────────────────

async function getReviews(locationName, pageSize = 50) {
    try {
        const data = await gbpGet(
            `https://mybusiness.googleapis.com/v4/${locationName}/reviews?pageSize=${pageSize}`
        );
        return data.reviews || data.locationReviews || [];
    } catch (e1) {
        try {
            const data = await gbpGet(
                `https://businessprofile.googleapis.com/v1/${locationName}/reviews?pageSize=${pageSize}`
            );
            return data.reviews || [];
        } catch (e2) {
            logger.warn("GBP: Reviews unavailable", { location: locationName, error: e2.message });
            return [];
        }
    }
}

// ─── Performance ────────────────────────────────────────────────────────────

async function getPerformance(locationName, startDate, endDate) {
    const [sy, sm, sd] = startDate.split("-").map(Number);
    const [ey, em, ed] = endDate.split("-").map(Number);
    const metrics = [
        "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
        "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
        "CALLS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS",
    ];

    try {
        const perfApi = google.mybusinessbusinessperformance({ version: "v1", auth: await getAuth() });
        const resp = await perfApi.accounts.locations.dailyMetricsTimeSeries.get({
            name: locationName,
            dailyMetric: metrics,
            "dailyRange.startDate.year": sy, "dailyRange.startDate.month": sm, "dailyRange.startDate.day": sd,
            "dailyRange.endDate.year": ey, "dailyRange.endDate.month": em, "dailyRange.endDate.day": ed,
        });
        return resp.data;
    } catch (err) {
        logger.warn("GBP: Performance SDK failed, trying REST", { error: err.message });
        try {
            const token = await getToken();
            const url = `https://businessprofileperformance.googleapis.com/v1/${locationName}:getDailyMetricsTimeSeries` +
                `?dailyRange.startDate.year=${sy}&dailyRange.startDate.month=${sm}&dailyRange.startDate.day=${sd}` +
                `&dailyRange.endDate.year=${ey}&dailyRange.endDate.month=${em}&dailyRange.endDate.day=${ed}` +
                metrics.map(m => `&dailyMetric=${m}`).join("");
            const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!resp.ok) return null;
            return await resp.json();
        } catch (e2) {
            logger.error("GBP: Performance REST failed", { error: e2.message });
            return null;
        }
    }
}

function extractTimeSeries(perfData, metricName) {
    const results = [];
    if (!perfData || !perfData.dailyMetricTimeSeries) return results;
    for (const series of perfData.dailyMetricTimeSeries) {
        if (series.dailyMetric === metricName) {
            const vals = series.timeSeries && series.timeSeries.datedValues || [];
            for (const v of vals) {
                results.push({ date: v.date || v.startDate, value: parseInt(v.value || 0) });
            }
        }
    }
    return results;
}

async function getCalls(loc, start, end) {
    const perf = await getPerformance(loc, start, end);
    return extractTimeSeries(perf, "CALLS").map(d => ({ date: d.date, calls: d.value }));
}

async function getDirections(loc, start, end) {
    const perf = await getPerformance(loc, start, end);
    return extractTimeSeries(perf, "BUSINESS_DIRECTION_REQUESTS").map(d => ({ date: d.date, directions: d.value }));
}

async function getWebsiteClicks(loc, start, end) {
    const perf = await getPerformance(loc, start, end);
    return extractTimeSeries(perf, "WEBSITE_CLICKS").map(d => ({ date: d.date, websiteClicks: d.value }));
}

// ─── Connection Test ───────────────────────────────────────────────────────

async function testConnection() {
    const start = Date.now();
    try {
        const { accounts, locations } = await getLocations();
        return {
            status: "CONNECTED",
            accounts: accounts.map(a => ({ name: a.name, accountId: a.name.split("/").pop(), displayName: a.displayName })),
            locationCount: locations.length,
            locationNames: locations.map(l => l.title),
            latencyMs: Date.now() - start,
            timestamp: new Date().toISOString(),
        };
    } catch (err) {
        return { status: "ERROR", error: err.message, latencyMs: Date.now() - start, timestamp: new Date().toISOString() };
    }
}

module.exports = { initClient, getAuth, getLocations, getLocation, getReviews, getPerformance, getCalls, getDirections, getWebsiteClicks, testConnection };