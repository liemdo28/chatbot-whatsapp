// Load .env if present (no external dependency — naive parse)
const fs = require('fs');
const path = require('path');
function loadDotEnv() {
    try {
        const envPath = path.join(__dirname, '.env');
        if (!fs.existsSync(envPath)) return;
        const raw = fs.readFileSync(envPath, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq <= 0) continue;
            const key = trimmed.slice(0, eq).trim();
            let val = trimmed.slice(eq + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (process.env[key] === undefined) process.env[key] = val;
        }
    } catch (e) {
        // Silent fail
    }
}
loadDotEnv();

const express = require('express');
const { readStore, update, log } = require('./db');
const { runAutoReplyCycle, checkConnection } = require('./auto-reply');
const scheduler = require('./scheduler');
const { createSeedStore } = require('./seed-data');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 8787;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function parseBooleanConfig(value, name) {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${name} must be a boolean`);
}

function parseMinRating(value) {
    const rating = Number.parseInt(value, 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new Error('min_rating_auto must be an integer from 1 to 5');
    }
    return rating;
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/approval', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'approval.html'));
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'review-auto-bridge',
        uptime_s: Math.floor(process.uptime()),
        mode: readStore().config?.dry_run ? 'DRY_RUN' : 'LIVE',
    });
});

app.get('/api/stats', (req, res) => {
    const store = readStore();
    const reviews = store.reviews || [];
    const queue = store.approval_queue || [];
    const pendingCeo = queue.filter(q => q.status === 'pending').length;
    const approvedCeo = queue.filter(q => q.status === 'approved').length;
    const rejectedCeo = queue.filter(q => q.status === 'rejected').length;
    const autoReplied = reviews.filter(r => r.status === 'replied' || r.status === 'auto_dry_run').length;
    const byRating = {};
    for (let i = 1; i <= 5; i++) byRating[i] = reviews.filter(r => r.rating === i).length;

    res.json({
        total_reviews: reviews.length,
        auto_replied: autoReplied,
        awaiting_ceo: reviews.filter(r => r.status === 'awaiting_ceo').length,
        pending_ceo_queue: pendingCeo,
        approved_ceo: approvedCeo,
        rejected_ceo: rejectedCeo,
        by_rating: byRating,
        by_platform: {
            google: reviews.filter(r => r.platform === 'google').length,
            yelp: reviews.filter(r => r.platform === 'yelp').length,
        },
        by_status: {
            pending: reviews.filter(r => r.status === 'pending').length,
            awaiting_ceo: reviews.filter(r => r.status === 'awaiting_ceo').length,
            replied: reviews.filter(r => r.status === 'replied').length,
            auto_dry_run: reviews.filter(r => r.status === 'auto_dry_run').length,
        },
        scheduler: store.scheduler,
        config: store.config,
        locations: store.locations,
    });
});

app.get('/api/reviews', (req, res) => {
    const store = readStore();
    res.json({ reviews: store.reviews });
});

app.get('/api/approval-queue', (req, res) => {
    const store = readStore();
    res.json({ queue: store.approval_queue });
});

app.get('/api/activity-log', (req, res) => {
    const store = readStore();
    res.json({ log: store.activity_log.slice(0, 50) });
});

app.post('/api/approval/:reviewId/approve', async (req, res) => {
    const reviewId = parseInt(req.params.reviewId, 10);
    const { reply, actor } = req.body;

    const result = update(store => {
        const queueItem = store.approval_queue.find(q => q.id === reviewId && q.status === 'pending');
        if (!queueItem) return null;

        const review = store.reviews.find(r => r.id === reviewId);
        if (review) {
            review.reply = reply || queueItem.suggested_reply;
            review.reply_mode = 'ceo_approved';
            review.replied_at = new Date().toISOString();
            review.status = 'replied';
        }

        queueItem.status = 'approved';
        queueItem.approved_reply = reply || queueItem.suggested_reply;
        queueItem.approved_by = actor || 'ceo';
        queueItem.approved_at = new Date().toISOString();

        log(store, {
            type: 'ceo_approved',
            review_id: reviewId,
            reviewer: queueItem.reviewer_name,
            approved_by: actor || 'ceo',
        });

        return queueItem;
    });

    if (!result) return res.status(404).json({ error: 'Queue item not found or already processed' });

    // In LIVE mode, attempt to post the approved reply to GBP
    const store = readStore();
    if (!store.config.dry_run && result.gbp_review_id) {
        try {
            const { postReplyToGBP } = require('./scraper');
            const post = await postReplyToGBP(result.gbp_review_id, result.approved_reply);
            update(s => {
                const r = s.reviews.find(rv => rv.id === reviewId);
                if (r) {
                    r.posted_to_gbp = true;
                    r.posted_at = new Date().toISOString();
                }
                log(s, { type: 'posted_to_gbp', review_id: reviewId, status: post?.status || 'unknown' });
            });
        } catch (err) {
            update(s => {
                log(s, { type: 'gbp_post_error', review_id: reviewId, error: err.message });
            });
        }
    }

    res.json({ status: 'approved', review: result });
});

app.post('/api/approval/:reviewId/reject', (req, res) => {
    const reviewId = parseInt(req.params.reviewId, 10);
    const { reason, actor } = req.body;

    const result = update(store => {
        const queueItem = store.approval_queue.find(q => q.id === reviewId && q.status === 'pending');
        if (!queueItem) return null;

        const review = store.reviews.find(r => r.id === reviewId);
        if (review) {
            review.status = 'rejected';
            review.replied_at = null;
        }

        queueItem.status = 'rejected';
        queueItem.rejected_by = actor || 'ceo';
        queueItem.rejected_at = new Date().toISOString();
        queueItem.rejection_reason = reason || '';

        log(store, {
            type: 'ceo_rejected',
            review_id: reviewId,
            reviewer: queueItem.reviewer_name,
            reason: reason || '',
            rejected_by: actor || 'ceo',
        });

        return queueItem;
    });

    if (!result) return res.status(404).json({ error: 'Queue item not found or already processed' });
    res.json({ status: 'rejected', review: result });
});

app.post('/api/approval/:reviewId/edit', (req, res) => {
    const reviewId = parseInt(req.params.reviewId, 10);
    const { reply } = req.body;

    if (!reply || !reply.trim()) {
        return res.status(400).json({ error: 'Reply text is required' });
    }

    const result = update(store => {
        const queueItem = store.approval_queue.find(q => q.id === reviewId && q.status === 'pending');
        if (!queueItem) return null;
        queueItem.suggested_reply = reply;
        queueItem.edited_at = new Date().toISOString();
        log(store, { type: 'ceo_edited', review_id: reviewId, new_length: reply.length });
        return queueItem;
    });

    if (!result) return res.status(404).json({ error: 'Queue item not found or already processed' });
    res.json({ status: 'edited', review: result });
});

app.post('/api/run-cycle', async (req, res) => {
    try {
        const result = await runAutoReplyCycle();
        res.json({ status: 'cycle_completed', ...result });
    } catch (err) {
        res.status(500).json({ status: 'cycle_failed', error: err.message });
    }
});

app.post('/api/reset', (req, res) => {
    const resetStore = createSeedStore(readStore().config, { includeReviews: false });
    update(store => {
        Object.assign(store, resetStore);
    });
    res.json({
        status: 'reset_complete',
        reviews: resetStore.reviews.length,
        queue: resetStore.approval_queue.length,
        source: 'empty_seed',
    });
});

app.post('/api/config', (req, res) => {
    const { scheduler_days, scheduler_time, min_rating_auto, auto_reply_enabled, dry_run } = req.body;
    const nextConfig = {};

    try {
        if (scheduler_days !== undefined) nextConfig.scheduler_days = scheduler.normalizeSchedulerDays(scheduler_days);
        if (scheduler_time !== undefined) nextConfig.scheduler_time = scheduler.parseSchedulerTime(scheduler_time).value;
        if (min_rating_auto !== undefined) nextConfig.min_rating_auto = parseMinRating(min_rating_auto);
        if (auto_reply_enabled !== undefined) nextConfig.auto_reply_enabled = parseBooleanConfig(auto_reply_enabled, 'auto_reply_enabled');
        if (dry_run !== undefined) nextConfig.dry_run = parseBooleanConfig(dry_run, 'dry_run');
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const result = update(store => {
        Object.assign(store.config, nextConfig);
        log(store, { type: 'config_updated', config: { ...store.config } });
    });

    scheduler.start(result.config.scheduler_days, result.config.scheduler_time);
    res.json({ status: 'updated', config: result.config });
});

app.get('/api/scheduler/next-run', (req, res) => {
    const store = readStore();
    const next = scheduler.getNextRunInfo(store.config.scheduler_days, store.config.scheduler_time);
    res.json({
        next_run: next ? next.toISOString() : null,
        cron_days: store.config.scheduler_days,
        cron_time: store.config.scheduler_time,
        timezone: 'America/Los_Angeles',
    });
});

app.get('/api/gbp/connection', async (req, res) => {
    try {
        const result = await checkConnection();
        res.json(result);
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ─── Startup ────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
    console.log(`[Bridge] Listening on http://localhost:${PORT}`);
    console.log(`[Bridge] Dashboard:    http://localhost:${PORT}/`);
    console.log(`[Bridge] CEO Approval: http://localhost:${PORT}/approval`);

    const store = readStore();
    const mode = store.config.dry_run ? '🟡 DRY RUN' : '🟢 LIVE';
    console.log(`[Bridge] Mode: ${mode}`);
    console.log(`[Bridge] Scheduler: ${store.config.scheduler_days.join(',')} at ${store.config.scheduler_time} PT`);

    // Test GBP connection async
    try {
        const conn = await checkConnection();
        if (conn.ok) {
            console.log(`[Bridge] ✅ GBP connection OK — ${conn.locationCount} locations: ${conn.locations.join(', ')}`);
        } else {
            console.warn(`[Bridge] ⚠️  GBP connection failed: ${conn.error}`);
        }
    } catch (err) {
        console.warn(`[Bridge] ⚠️  GBP connection error: ${err.message}`);
    }

    // Start scheduler (keeps running on Mon+Thu 08:00 PT)
    scheduler.start(store.config.scheduler_days, store.config.scheduler_time);
});
