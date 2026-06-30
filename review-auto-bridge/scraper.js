/**
 * Google Business Profile Scraper
 * Fetches live reviews when GBP quota is available and falls back to bundled mock data.
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { createSeedStore } = require('./seed-data');
const { scrapeReviewsViaBrowser } = require('./browser-review-scraper');

const GBP_SCOPES = ['https://www.googleapis.com/auth/business.manage'];
const REVIEW_API_BASE = 'https://mybusiness.googleapis.com/v4';
const ACCOUNTS_API_BASE = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const LOCATIONS_API_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';

let authClient = null;

function resolveCredentials() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (fs.existsSync(configured)) return configured;
    }

    const local = path.join(__dirname, 'mi-gbp-service-account.json');
    if (fs.existsSync(local)) return local;

    const shared = path.join(__dirname, '..', 'whatsapp-ai-gateway', 'mi-gbp-service-account.json');
    if (fs.existsSync(shared)) return shared;

    const dev = 'C:\\Users\\hoang\\Downloads\\source\\mi-gbp-service-account.json';
    if (fs.existsSync(dev)) return dev;

    return null;
}

function readFallbackStore() {
    const storePath = path.join(__dirname, 'data', 'store.json');
    if (!fs.existsSync(storePath)) {
        return createSeedStore();
    }

    try {
        return JSON.parse(fs.readFileSync(storePath, 'utf8'));
    } catch {
        return createSeedStore();
    }
}

function buildMockLocations(reason) {
    const store = readFallbackStore();
    return (store.locations || []).map(location => ({
        accountName: 'accounts/mock',
        locationName: `accounts/mock/locations/${location.id}`,
        locationId: String(location.id),
        title: location.name,
        address: { locality: location.city || '', administrativeArea: location.state || '' },
        phone: '',
        isMock: true,
        fallbackReason: reason,
    }));
}

function buildMockReviews(locations) {
    const store = createSeedStore();
    return (store.reviews || []).map(review => ({
        gbp_review_id: review.gbp_review_id || `mock_review_${review.id}`,
        location_id: String(review.location_id),
        location_name: locations.find(location => location.locationId === String(review.location_id))?.title || `Store #${review.location_id}`,
        platform: review.platform || 'google',
        rating: review.rating,
        reviewer_name: review.reviewer_name,
        review_text: review.review_text,
        review_date: review.review_date || new Date().toISOString(),
        review_url: review.review_url || null,
        status: 'pending',
        reply: null,
        replied_at: null,
        reply_mode: null,
    }));
}

async function browserFallback(reason, errors = []) {
    try {
        const browserResult = await scrapeReviewsViaBrowser();
        if (Array.isArray(browserResult.reviews) && browserResult.reviews.length > 0) {
            return {
                reviews: browserResult.reviews,
                errors: [
                    ...errors,
                    { location: 'Google API', error: reason || 'Using browser fallback because GBP API is unavailable.' },
                    ...(browserResult.errors || []),
                ],
                locationCount: browserResult.locationCount,
                source: 'browser_fallback',
            };
        }
        throw new Error('Browser fallback returned no reviews.');
    } catch (browserErr) {
        const locations = buildMockLocations(browserErr.message || reason);
        const reviews = buildMockReviews(locations);
        return {
            reviews,
            errors: [
                ...errors,
                { location: 'Google API', error: reason || 'Google API rate limited or offline.' },
                { location: 'Browser fallback', error: browserErr.message },
                { location: 'Seed fallback', error: 'Using bundled mock reviews fallback.' },
            ],
            locationCount: locations.length,
            source: 'mock_fallback',
        };
    }
}

async function initClient() {
    if (authClient) return authClient;

    const keyFile = resolveCredentials();
    if (!keyFile) {
        throw new Error('[GBP Scraper] No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or place mi-gbp-service-account.json');
    }

    console.log('[GBP Scraper] Loading credentials from:', keyFile);
    const key = JSON.parse(fs.readFileSync(keyFile, 'utf-8'));
    const googleAuth = new google.auth.GoogleAuth({ credentials: key, scopes: GBP_SCOPES });
    authClient = await googleAuth.getClient();
    console.log('[GBP Scraper] Auth client initialized');
    return authClient;
}

async function getToken() {
    const client = await initClient();
    const tokenResponse = await client.getAccessToken();
    return tokenResponse.token || tokenResponse;
}

async function gbpGet(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        const token = await getToken();
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const text = await response.text();

        if (response.status === 429 && attempt < retries) {
            const waitMs = attempt * 5000;
            console.warn(`[GBP Scraper] Rate limited, retrying in ${waitMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
            continue;
        }

        if (!response.ok) {
            throw new Error(`GBP API ${response.status}: ${text.slice(0, 300)}`);
        }

        return JSON.parse(text);
    }

    throw new Error('GBP API request exhausted retries');
}

async function getAccountLocations() {
    try {
        const accountsData = await gbpGet(`${ACCOUNTS_API_BASE}/accounts`);
        const accounts = accountsData.accounts || [];
        const allLocations = [];

        for (const account of accounts) {
            const params = new URLSearchParams({
                readMask: 'name,title,storefrontAddress,phoneNumbers',
                pageSize: '100',
            });
            const locationsData = await gbpGet(`${LOCATIONS_API_BASE}/${account.name}/locations?${params.toString()}`);
            const locations = locationsData.locations || [];

            for (const location of locations) {
                allLocations.push({
                    accountName: account.name,
                    locationName: location.name,
                    locationId: location.name.split('/').pop(),
                    title: location.title,
                    address: location.storefrontAddress,
                    phone: location.phoneNumbers?.primaryPhone,
                });
            }
        }

        return allLocations;
    } catch (err) {
        console.warn('[GBP Scraper] Failed to fetch account locations from Google API. Trying fallback to local store.json:', err.message);
        const mockLocations = buildMockLocations(err.message);
        if (mockLocations.length > 0) {
            return mockLocations;
        }
        throw err;
    }
}

async function fetchReviewsForLocation(locationName, pageSize = 50) {
    const endpoints = [
        `${REVIEW_API_BASE}/${locationName}/reviews?pageSize=${pageSize}`,
        `${REVIEW_API_BASE}/${locationName}/reviews?pageSize=${pageSize}&ignoreDisabledAccounts=true`,
    ];

    for (const endpoint of endpoints) {
        try {
            const data = await gbpGet(endpoint);
            if (Array.isArray(data.reviews) && data.reviews.length > 0) {
                return data.reviews;
            }
        } catch {
            // Try the next compatible endpoint.
        }
    }

    return [];
}

async function scrapeAllReviews() {
    console.log('[GBP Scraper] Starting review scrape...');

    let locations;
    let isMockFallback = false;
    try {
        locations = await getAccountLocations();
        isMockFallback = locations.some(location => location.isMock);
    } catch (err) {
        console.error('[GBP Scraper] Critical error getting locations:', err.message);
        return { reviews: [], errors: [{ location: 'Google API', error: err.message }], locationCount: 0, source: 'error' };
    }

    console.log(`[GBP Scraper] Found ${locations.length} locations (mock fallback: ${isMockFallback})`);

    if (isMockFallback) {
        console.warn('[GBP Scraper] API unavailable, attempting browser fallback...');
        return browserFallback(
            locations.find(location => location.fallbackReason)?.fallbackReason || 'Google API rate limited or offline.',
            []
        );
    }

    const allReviews = [];
    const errors = [];

    for (const location of locations) {
        try {
            console.log(`[GBP Scraper] Fetching reviews for: ${location.title}`);
            const reviews = await fetchReviewsForLocation(location.locationName);
            console.log(`  -> Got ${reviews.length} reviews`);

            for (const review of reviews) {
                allReviews.push({
                    gbp_review_id: review.reviewId || review.name,
                    location_id: location.locationId,
                    location_name: location.title,
                    platform: 'google',
                    rating: review.starRating || review.rating,
                    reviewer_name: review.reviewer?.displayName || review.reviewer?.name || 'Anonymous',
                    review_text: review.comment || '',
                    review_date: review.createTime || review.updateTime || new Date().toISOString(),
                    review_url: review.reviewReply?.uri || null,
                    status: 'pending',
                    reply: null,
                    replied_at: null,
                    reply_mode: null,
                });
            }
        } catch (err) {
            console.error(`[GBP Scraper] Error for ${location.title}:`, err.message);
            errors.push({ location: location.title, error: err.message });
        }
    }

    if (allReviews.length === 0 && errors.length > 0) {
        console.warn('[GBP Scraper] Failed to fetch any reviews from live API. Attempting browser fallback.');
        return browserFallback('Failed to fetch live reviews (quota/connection).', errors);
    }

    console.log(`[GBP Scraper] Done - ${allReviews.length} reviews from ${locations.length} locations, ${errors.length} errors`);
    return {
        reviews: allReviews,
        errors,
        locationCount: locations.length,
        source: 'live',
    };
}

async function testConnection() {
    try {
        await initClient();
        const locations = await getAccountLocations();
        const isMock = locations.some(location => location.isMock);
        return {
            ok: true,
            live: !isMock,
            mock: isMock,
            source: isMock ? 'mock_fallback' : 'live',
            locationCount: locations.length,
            locations: locations.map(location => location.title),
            warning: isMock ? locations.find(location => location.fallbackReason)?.fallbackReason || 'Using bundled mock fallback.' : null,
        };
    } catch (err) {
        return {
            ok: false,
            live: false,
            mock: false,
            source: 'error',
            error: err.message,
        };
    }
}

async function postReplyToGBP(reviewName, comment) {
    if (!reviewName || !comment) {
        throw new Error('postReplyToGBP: reviewName and comment are required');
    }

    if (reviewName.startsWith('mock_review_') || reviewName.includes('/locations/mock')) {
        console.log(`[GBP Scraper] Simulating reply post for mock review ${reviewName}...`);
        return { status: 'posted_mock', reviewName, response: { comment } };
    }

    const token = await getToken();
    const url = `${REVIEW_API_BASE}/${reviewName}/reply`;
    console.log(`[GBP Scraper] Posting reply to ${reviewName}...`);

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment }),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`GBP reply POST ${response.status}: ${text.slice(0, 300)}`);
    }

    const data = JSON.parse(text);
    console.log(`[GBP Scraper] Reply posted to ${reviewName}`);
    return { status: 'posted', reviewName, response: data };
}

module.exports = { scrapeAllReviews, testConnection, getAccountLocations, postReplyToGBP };
