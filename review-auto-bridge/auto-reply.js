const { update, log } = require('./db');
const { scrapeAllReviews, testConnection } = require('./scraper');

const TONE_MODES = {
    gentle_professional: 'Thank you so much for your kind review. We are very happy to hear you enjoyed your visit, and we look forward to welcoming you back again soon.',
    warm_hospitality: 'Thank you so much for spending time with us and for sharing such kind feedback. We are really glad you had a good visit, and we would love to welcome you back again soon.',
    premium_brand: 'Thank you for your thoughtful review. We truly appreciate your support and are delighted to know the visit left a strong impression. We look forward to welcoming you back again soon.',
    negative_warm: 'Thank you for sharing your feedback with us. We are sorry to hear your visit did not feel as it should have, and we would appreciate the chance to learn more and follow up directly.',
    negative_professional: 'Thank you for your feedback. We are sorry your experience did not meet expectations, and we would appreciate the chance to follow up with you directly.',
    mixed_professional: 'Thank you for taking the time to share your feedback. We appreciate hearing about your visit and will use your comments to keep improving both the food and the service experience.',
};

function generateReply(rating, reviewText, tone = 'gentle_professional') {
    const text = (reviewText || '').toLowerCase();
    if (rating >= 4) {
        return TONE_MODES[tone] || TONE_MODES.gentle_professional;
    }
    if (rating === 3) {
        return TONE_MODES.mixed_professional;
    }
    if (rating === 2) {
        return TONE_MODES.negative_warm;
    }
    return TONE_MODES.negative_professional;
}

function classifySentiment(rating, reviewText) {
    if (rating >= 4) return 'positive';
    if (rating === 3) return 'mixed';
    return 'negative';
}

function detectRiskFlags(reviewText, rating) {
    const text = (reviewText || '').toLowerCase();
    const flags = [];
    const riskKeywords = [
        'allergy', 'allergic', 'food poisoning', 'undercooked', 'raw food',
        'health', 'safety', 'unsafe', 'discrimination', 'racist', 'harassment',
        'lawsuit', 'lawyer', 'legal', 'refund', 'chargeback', 'billing issue',
        'theft', 'stole', 'fraud', 'hair', 'foreign object',
    ];
    for (const kw of riskKeywords) {
        if (text.includes(kw)) flags.push(kw);
    }
    if (rating <= 2) flags.push('high_reputation_risk');
    if (text.includes('dirty') || text.includes('smell') || text.includes('hygiene')) {
        flags.push('health_perception_risk');
    }
    return [...new Set(flags)];
}

function evaluateReview(review, config) {
    const { min_rating_auto, auto_reply_enabled = true } = config || {};
    const riskFlags = detectRiskFlags(review.review_text, review.rating);

    if (review.status === 'replied') {
        return { action: 'skip', reason: 'Already replied', riskFlags };
    }
    if (review.source === 'browser_fallback') {
        return { action: 'ceo_approval', reason: 'Browser-scraped review requires CEO approval before posting', riskFlags };
    }
    if (riskFlags.length > 0) {
        return { action: 'ceo_approval', reason: `Risk flags: ${riskFlags.join(', ')}`, riskFlags };
    }
    if (review.rating <= 3) {
        return { action: 'ceo_approval', reason: `${review.rating}-star review requires CEO approval`, riskFlags };
    }
    if (review.rating < (min_rating_auto || 4)) {
        return { action: 'ceo_approval', reason: `Rating ${review.rating} below auto threshold (${min_rating_auto})`, riskFlags };
    }
    if (!auto_reply_enabled) {
        return { action: 'ceo_approval', reason: 'Auto-reply disabled in config', riskFlags };
    }
    if (review.rating >= (min_rating_auto || 4)) {
        return { action: 'auto', reason: `${review.rating}-star positive review — eligible for auto reply`, riskFlags };
    }
    return { action: 'ceo_approval', reason: 'Default: requires approval', riskFlags };
}

/**
 * Update locations list from real GBP API
 * Falls back to existing list if API fails.
 */
async function refreshLocations(store) {
    try {
        const result = await scrapeAllReviews();
        if (!result || !Array.isArray(result.reviews)) {
            console.warn('[AutoReply] Scrape returned no reviews, keeping existing data');
            return { added: 0, errors: result?.errors || [] };
        }
        const liveLocations = new Map();
        for (const r of result.reviews) {
            if (r.location_id) {
                liveLocations.set(r.location_id, {
                    id: r.location_id,
                    name: r.location_name || `Store #${r.location_id}`,
                    platform: r.platform || 'google',
                });
            }
        }
        if (liveLocations.size > 0) {
            store.locations = [...liveLocations.values()];
        }
        return result;
    } catch (err) {
        console.error('[AutoReply] refreshLocations failed:', err.message);
        return { added: 0, errors: [{ error: err.message }], reviews: [] };
    }
}

/**
 * Async auto-reply cycle. Pulls real reviews from GBP API and processes them.
 */
async function runAutoReplyCycle() {
    const store = (update(s => s) || {});
    let liveResult;
    try {
        liveResult = await scrapeAllReviews();
    } catch (err) {
        console.error('[AutoReply] GBP scrape failed:', err.message);
        update(s => {
            log(s, { type: 'scrape_error', error: err.message });
            s.scheduler.last_auto_reply = new Date().toISOString();
            s.scheduler.runs_today = (s.scheduler.runs_today || 0) + 1;
        });
        return { ok: false, error: err.message, scraped: 0, autoPosted: 0, sentToCeo: 0 };
    }

    if (!liveResult || !Array.isArray(liveResult.reviews)) {
        liveResult = { reviews: [], errors: [], locationCount: 0 };
    }

    const { min_rating_auto, dry_run, auto_reply_enabled } = store.config;
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    let added = 0;
    let autoPosted = 0;
    let sentToCeo = 0;
    const posted = [];
    const queued = [];

    update(s => {
        const todayKey = now.split('T')[0];
        if (s.scheduler.runs_today_date !== todayKey) {
            s.scheduler.runs_today = 0;
            s.scheduler.runs_today_date = todayKey;
        }

        // Sync locations from real data
        const liveLocations = new Map();
        for (const r of liveResult.reviews) {
            if (r.location_id) {
                const existingLocation = s.locations.find(location => String(location.id) === String(r.location_id));
                liveLocations.set(r.location_id, {
                    id: r.location_id,
                    name: r.location_name || `Store #${r.location_id}`,
                    slug: r.location_name?.toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '') || `store-${r.location_id}`,
                    platform: existingLocation?.platform || (r.platform === 'google' ? 'google' : 'google'),
                });
            }
        }
        if (liveLocations.size > 0) {
            s.locations = [...liveLocations.values()];
        }

        // Identify existing reviews (by gbp_review_id or composite)
        const seen = new Set();
        for (const r of s.reviews) {
            if (r.gbp_review_id) seen.add(`gbp:${r.gbp_review_id}`);
            else if (r.reviewer_name && r.review_date) {
                seen.add(`${r.reviewer_name}|${r.review_date}|${r.location_id}`);
            }
        }

        // Add new reviews
        let nextId = s.reviews.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
        for (const live of liveResult.reviews) {
            const key = live.gbp_review_id
                ? `gbp:${live.gbp_review_id}`
                : `${live.reviewer_name}|${live.review_date}|${live.location_id}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const evaluation = evaluateReview({
                review_text: live.review_text,
                rating: live.rating,
                status: 'pending',
                source: live.source,
            }, { min_rating_auto, auto_reply_enabled });

            const reviewRecord = {
                id: nextId++,
                gbp_review_id: live.gbp_review_id || null,
                location_id: live.location_id,
                platform: live.platform || 'google',
                rating: live.rating,
                reviewer_name: live.reviewer_name,
                review_text: live.review_text,
                review_date: live.review_date,
                review_url: live.review_url || null,
                source: live.source || liveResult.source || 'live',
                source_quality: live.source_quality || null,
                aggregate_rating: live.aggregate_rating ?? null,
                aggregate_review_count: live.aggregate_review_count ?? null,
                status: 'pending',
                reply: null,
                replied_at: null,
                reply_mode: null,
                risk_flags: evaluation.riskFlags,
            };

            const replyText = generateReply(live.rating, live.review_text);
            const location = s.locations.find(l => l.id === live.location_id);

            if (evaluation.action === 'auto') {
                reviewRecord.reply = replyText;
                reviewRecord.reply_mode = dry_run ? 'auto_dry_run' : 'auto';
                reviewRecord.replied_at = now;
                reviewRecord.status = dry_run ? 'auto_dry_run' : 'replied';
                autoPosted++;
                added++;
                posted.push(`${live.reviewer_name} (${live.rating}★ @ ${location?.name || live.location_id})`);

                log(s, {
                    type: 'auto_reply',
                    review_id: reviewRecord.id,
                    reviewer: live.reviewer_name,
                    rating: live.rating,
                    location: location?.name,
                    platform: live.platform,
                    mode: reviewRecord.reply_mode,
                    sentiment: classifySentiment(live.rating, live.review_text),
                    source: reviewRecord.source,
                });
            } else {
                const queueEntry = {
                    id: reviewRecord.id,
                    reviewer_name: live.reviewer_name,
                    rating: live.rating,
                    review_text: live.review_text,
                    review_date: live.review_date,
                    platform: live.platform,
                    location: location?.name,
                    location_id: live.location_id,
                    gbp_review_id: live.gbp_review_id,
                    suggested_reply: replyText,
                    submitted_by: 'system',
                    submitted_at: now,
                    status: 'pending',
                    decision_reason: evaluation.reason,
                    risk_flags: evaluation.riskFlags,
                    sentiment: classifySentiment(live.rating, live.review_text),
                    source: reviewRecord.source,
                    source_quality: reviewRecord.source_quality,
                };
                s.approval_queue.push(queueEntry);
                reviewRecord.status = 'awaiting_ceo';
                sentToCeo++;
                added++;
                queued.push(`${live.reviewer_name} (${live.rating}★ @ ${location?.name || live.location_id})`);

                log(s, {
                    type: 'ceo_queue',
                    review_id: reviewRecord.id,
                    reviewer: live.reviewer_name,
                    rating: live.rating,
                    location: location?.name,
                    platform: live.platform,
                    reason: evaluation.reason,
                    risk_flags: evaluation.riskFlags,
                    source: reviewRecord.source,
                });
            }

            s.reviews.push(reviewRecord);
        }

        s.scheduler.runs_today = (s.scheduler.runs_today || 0) + 1;
        s.scheduler.last_auto_reply = now;
        if (liveResult.locationCount !== undefined) {
            s.scheduler.last_scrape_locations = liveResult.locationCount;
        }
        if (liveResult.errors && liveResult.errors.length > 0) {
            log(s, { type: 'scrape_partial', errors: liveResult.errors });
        } else {
            log(s, {
                type: 'scrape_complete',
                locations: liveResult.locationCount || 0,
                scraped: liveResult.reviews?.length || 0,
                new_reviews: added,
            });
        }
    });

    console.log(`[AutoReply] Cycle complete — scraped=${liveResult.reviews.length}, new=${added}, auto_posted=${autoPosted}, ceo_queue=${sentToCeo}`);
    if (posted.length > 0) console.log('[AutoReply] Auto-posted:', posted.join(', '));
    if (queued.length > 0) console.log('[AutoReply] CEO approval:', queued.join(', '));

    return {
        ok: true,
        scraped: liveResult.reviews.length,
        new: added,
        autoPosted,
        sentToCeo,
        locations: liveResult.locationCount || 0,
        errors: liveResult.errors || [],
    };
}

async function checkConnection() {
    return testConnection();
}

module.exports = {
    runAutoReplyCycle,
    evaluateReview,
    generateReply,
    classifySentiment,
    detectRiskFlags,
    scrapeAllReviews,
    refreshLocations,
    checkConnection,
};
