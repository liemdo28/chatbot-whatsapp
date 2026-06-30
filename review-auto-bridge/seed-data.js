const DEFAULT_TZ = 'America/Los_Angeles';

const POSITIVE_REPLY = 'Thank you so much for your kind review. We are very happy to hear you enjoyed your visit, and we look forward to welcoming you back again soon.';
const MIXED_REPLY = 'Thank you for taking the time to share your feedback. We appreciate hearing about your visit and will use your comments to keep improving both the food and the service experience.';
const NEGATIVE_WARM_REPLY = 'Thank you for sharing your feedback with us. We are sorry to hear your visit did not feel as it should have, and we would appreciate the chance to learn more and follow up directly.';
const NEGATIVE_PRO_REPLY = 'Thank you for your feedback. We are sorry your experience did not meet expectations, and we would appreciate the chance to follow up with you directly.';

const SEED_LOCATIONS = [
    { id: '4', name: 'Bakudan Ramen (Stone Oak)', slug: 'bakudan-ramen-stone-oak', platform: 'google' },
    { id: '2', name: 'Bakudan Ramen (Bandera)', slug: 'bakudan-ramen-bandera', platform: 'google' },
    { id: '1', name: 'Raw Sushi Bistro', slug: 'raw-sushi-bistro', platform: 'google' },
    { id: '3', name: 'Bakudan Ramen (The Rim)', slug: 'bakudan-ramen-the-rim', platform: 'google' },
];

const SEED_REVIEWS = [
    { id: 1, gbp_review_id: 'mock_review_1', location_id: '4', platform: 'google', rating: 5, reviewer_name: 'Sarah M.', review_text: 'Best ramen in San Antonio! The tonkotsu broth is incredible. Will definitely come back.', review_date: '2026-06-28T10:04:06.636Z', status: 'replied', reply: POSITIVE_REPLY, reply_mode: 'auto', risk_flags: [] },
    { id: 2, gbp_review_id: 'mock_review_2', location_id: '4', platform: 'google', rating: 5, reviewer_name: 'Mike T.', review_text: 'Amazing food and great service. Highly recommend the spicy miso ramen!', review_date: '2026-06-28T10:04:06.636Z', status: 'replied', reply: POSITIVE_REPLY, reply_mode: 'auto', risk_flags: [] },
    { id: 3, gbp_review_id: 'mock_review_3', location_id: '4', platform: 'google', rating: 4, reviewer_name: 'Jenny L.', review_text: 'Really good ramen, the gyoza was excellent too. Only slight issue was the wait time.', review_date: '2026-06-27T10:04:06.636Z', status: 'replied', reply: POSITIVE_REPLY, reply_mode: 'auto', risk_flags: [] },
    { id: 4, gbp_review_id: 'mock_review_4', location_id: '4', platform: 'yelp', rating: 4, reviewer_name: 'David K.', review_text: 'Solid ramen spot. Good portion sizes and fresh ingredients. Would return.', review_date: '2026-06-26T10:04:06.636Z', status: 'replied', reply: POSITIVE_REPLY, reply_mode: 'auto', risk_flags: [] },
    { id: 5, gbp_review_id: 'mock_review_5', location_id: '4', platform: 'google', rating: 3, reviewer_name: 'Chris R.', review_text: 'Decent ramen but felt a bit overpriced for the portion size. Service was fine though.', review_date: '2026-06-27T10:04:06.636Z', status: 'awaiting_ceo', reply: null, reply_mode: null, risk_flags: [] },
    { id: 6, gbp_review_id: 'mock_review_6', location_id: '4', platform: 'yelp', rating: 2, reviewer_name: 'Alex B.', review_text: 'Waited 45 minutes for cold ramen. The broth was lukewarm at best. Very disappointed.', review_date: '2026-06-28T10:04:06.636Z', status: 'awaiting_ceo', reply: null, reply_mode: null, risk_flags: ['high_reputation_risk'] },
    { id: 7, gbp_review_id: 'mock_review_7', location_id: '4', platform: 'google', rating: 1, reviewer_name: 'Tom H.', review_text: 'Found hair in my ramen. Asked manager and got no real apology. Never coming back.', review_date: '2026-06-25T10:04:06.636Z', status: 'awaiting_ceo', reply: null, reply_mode: null, risk_flags: ['hair', 'high_reputation_risk'] },
    { id: 8, gbp_review_id: 'mock_review_8', location_id: '2', platform: 'google', rating: 5, reviewer_name: 'Lisa W.', review_text: 'The ramen here is absolutely fantastic! Authentic taste and wonderful atmosphere.', review_date: '2026-06-28T10:04:06.636Z', status: 'replied', reply: POSITIVE_REPLY, reply_mode: 'auto', risk_flags: [] },
    { id: 9, gbp_review_id: 'mock_review_9', location_id: '2', platform: 'yelp', rating: 4, reviewer_name: 'Robert J.', review_text: 'Great ramen. Only thing is parking can be tricky on weekends.', review_date: '2026-06-26T10:04:06.636Z', status: 'replied', reply: POSITIVE_REPLY, reply_mode: 'auto', risk_flags: [] },
    { id: 10, gbp_review_id: 'mock_review_10', location_id: '2', platform: 'google', rating: 3, reviewer_name: 'Karen S.', review_text: 'Food was okay, not amazing. Some dishes were better than others.', review_date: '2026-06-24T10:04:06.636Z', status: 'awaiting_ceo', reply: null, reply_mode: null, risk_flags: [] },
    { id: 11, gbp_review_id: 'mock_review_11', location_id: '1', platform: 'google', rating: 5, reviewer_name: 'Hiro N.', review_text: 'Fresh sushi, generous portions, and the spicy tuna roll is the best in town!', review_date: '2026-06-27T10:04:06.636Z', status: 'replied', reply: POSITIVE_REPLY, reply_mode: 'auto', risk_flags: [] },
    { id: 12, gbp_review_id: 'mock_review_12', location_id: '1', platform: 'google', rating: 4, reviewer_name: 'Emma P.', review_text: 'Love this place! Great for a quick sushi lunch. Very fresh fish.', review_date: '2026-06-26T10:04:06.636Z', status: 'replied', reply: POSITIVE_REPLY, reply_mode: 'auto', risk_flags: [] },
    { id: 13, gbp_review_id: 'mock_review_13', location_id: '3', platform: 'yelp', rating: 5, reviewer_name: 'Mark D.', review_text: 'Best ramen I have had outside of Japan. Truly authentic flavors!', review_date: '2026-06-28T10:04:06.636Z', status: 'replied', reply: POSITIVE_REPLY, reply_mode: 'auto', risk_flags: [] },
    { id: 14, gbp_review_id: 'mock_review_14', location_id: '3', platform: 'google', rating: 4, reviewer_name: 'Amy C.', review_text: 'Really nice experience. The staff were friendly and the ramen was delicious.', review_date: '2026-06-27T10:04:06.636Z', status: 'replied', reply: POSITIVE_REPLY, reply_mode: 'auto', risk_flags: [] },
];

const SEED_APPROVAL_QUEUE = [
    { id: 5, reviewer_name: 'Chris R.', rating: 3, review_text: 'Decent ramen but felt a bit overpriced for the portion size. Service was fine though.', review_date: '2026-06-27T10:04:06.636Z', platform: 'google', location: 'Bakudan Ramen (Stone Oak)', location_id: '4', gbp_review_id: 'mock_review_5', suggested_reply: MIXED_REPLY, submitted_by: 'system', status: 'pending', decision_reason: '3-star review requires CEO approval', risk_flags: [], sentiment: 'mixed' },
    { id: 6, reviewer_name: 'Alex B.', rating: 2, review_text: 'Waited 45 minutes for cold ramen. The broth was lukewarm at best. Very disappointed.', review_date: '2026-06-28T10:04:06.636Z', platform: 'yelp', location: 'Bakudan Ramen (Stone Oak)', location_id: '4', gbp_review_id: 'mock_review_6', suggested_reply: NEGATIVE_WARM_REPLY, submitted_by: 'system', status: 'pending', decision_reason: 'Risk flags: high_reputation_risk', risk_flags: ['high_reputation_risk'], sentiment: 'negative' },
    { id: 7, reviewer_name: 'Tom H.', rating: 1, review_text: 'Found hair in my ramen. Asked manager and got no real apology. Never coming back.', review_date: '2026-06-25T10:04:06.636Z', platform: 'google', location: 'Bakudan Ramen (Stone Oak)', location_id: '4', gbp_review_id: 'mock_review_7', suggested_reply: NEGATIVE_PRO_REPLY, submitted_by: 'system', status: 'pending', decision_reason: 'Risk flags: hair, high_reputation_risk', risk_flags: ['hair', 'high_reputation_risk'], sentiment: 'negative' },
    { id: 10, reviewer_name: 'Karen S.', rating: 3, review_text: 'Food was okay, not amazing. Some dishes were better than others.', review_date: '2026-06-24T10:04:06.636Z', platform: 'google', location: 'Bakudan Ramen (Bandera)', location_id: '2', gbp_review_id: 'mock_review_10', suggested_reply: MIXED_REPLY, submitted_by: 'system', status: 'pending', decision_reason: '3-star review requires CEO approval', risk_flags: [], sentiment: 'mixed' },
];

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function parseBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
}

function buildDefaultConfig() {
    const minRating = Number.parseInt(process.env.MIN_RATING_AUTO, 10);
    const schedulerDays = String(process.env.SCHEDULER_DAYS || '1,4')
        .split(',')
        .map(day => day.trim())
        .filter(Boolean);

    return {
        auto_reply_enabled: parseBoolean(process.env.AUTO_REPLY_ENABLED, true),
        scheduler_days: schedulerDays.length > 0 ? schedulerDays : ['1', '4'],
        scheduler_time: process.env.SCHEDULER_TIME || '08:00',
        timezone: process.env.TZ || DEFAULT_TZ,
        min_rating_auto: Number.isInteger(minRating) ? minRating : 4,
        dry_run: parseBoolean(process.env.DRY_RUN, false),
    };
}

function createSeedStore(configOverrides = {}, options = {}) {
    const now = new Date().toISOString();
    const includeReviews = options.includeReviews !== false;
    const reviews = includeReviews
        ? clone(SEED_REVIEWS).map(review => ({
            ...review,
            replied_at: review.status === 'replied' ? now : null,
            review_url: review.review_url || null,
        }))
        : [];
    const approvalQueue = includeReviews
        ? clone(SEED_APPROVAL_QUEUE).map(item => ({
            ...item,
            submitted_at: now,
        }))
        : [];

    return {
        reviews,
        locations: clone(SEED_LOCATIONS),
        approval_queue: approvalQueue,
        activity_log: [
            {
                type: 'seed',
                message: includeReviews
                    ? `Seeded ${reviews.length} mock reviews across ${SEED_LOCATIONS.length} locations`
                    : `Seeded ${SEED_LOCATIONS.length} locations with empty review state`,
                ts: now,
            },
        ],
        scheduler: {
            last_pull: null,
            last_auto_reply: null,
            runs_today: 0,
            runs_today_date: null,
            last_scrape_locations: SEED_LOCATIONS.length,
        },
        config: {
            ...buildDefaultConfig(),
            ...configOverrides,
        },
    };
}

module.exports = {
    buildDefaultConfig,
    createSeedStore,
};
