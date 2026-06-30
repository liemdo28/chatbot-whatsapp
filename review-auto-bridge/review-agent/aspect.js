// Aspect detection — keyword-based detector (no ML deps)
// Maps review text → list of aspect tags.
// Inspired by open-source ABSA pipelines, simplified to rule-based for portability.

const ASPECT_KEYWORDS = {
    food_quality: [
        'food', 'dish', 'dishes', 'meal', 'ramen', 'sushi', 'noodle', 'noodles', 'broth',
        'rice', 'soup', 'taste', 'flavor', 'flavour', 'fresh', 'cold', 'lukewarm', 'hot',
        'undercooked', 'overcooked', 'salty', 'soggy', 'crispy', 'spicy', 'bland',
        'seasoning', 'ingredient', 'ingredients', 'cooked', 'raw', 'stale', 'portion',
        'portions', 'quality', 'menu item', 'menu',
    ],
    service: [
        'service', 'server', 'servers', 'waiter', 'waitress', 'staff', 'host', 'hostess',
        'manager', 'check on', 'checked on', 'followed up', 'attentive', 'ignored',
        'forgot', 'forgotten', 'refused', 'help', 'helped',
    ],
    wait_time: [
        'wait', 'waited', 'waiting', 'long', 'slow', 'forever', 'minutes', 'min',
        'hour', 'hours', 'quick', 'fast', 'prompt', 'delay', 'delayed', 'late',
    ],
    price: [
        'price', 'pricey', 'expensive', 'overpriced', 'cheap', 'value', 'cost', 'costly',
        'worth', 'money', '$', 'usd', 'dollars', 'bill',
    ],
    cleanliness: [
        'dirty', 'clean', 'filthy', 'smell', 'hygiene', 'sanitary', 'restroom', 'bathroom',
        'table', 'floor', 'sticky', 'crumbs', 'unclean', 'trash', 'roach', 'bug', 'pest',
    ],
    delivery: [
        'delivery', 'delivered', 'doordash', 'uber eats', 'grubhub', 'driver', 'courier',
        'package', 'shipped', 'shipping', 'cold when', 'late delivery', 'missing items',
    ],
    order_accuracy: [
        'wrong order', 'wrong item', 'missing item', 'missing items', 'forgot my order',
        'incorrect', 'not what i ordered', 'didn\'t include', 'missing sides',
        'left out', 'order mix', 'mistake',
    ],
    staff_attitude: [
        'rude', 'attitude', 'friendly', 'unfriendly', 'kind', 'mean', 'aggressive',
        'polite', 'impolite', 'smiled', 'smile', 'welcoming', 'hostile', 'dismissive',
        'sarcastic', 'condescending', 'cold shoulder', 'unhelpful', 'helpful',
    ],
    atmosphere: [
        'atmosphere', 'vibe', 'ambience', 'ambiance', 'noise', 'noisy', 'loud', 'quiet',
        'music', 'decoration', 'decor', 'lighting', 'cozy', 'crowded', 'empty',
    ],
    menu_item: [
        'spicy miso ramen', 'tonkotsu', 'gyoza', 'karaage', 'sushi roll', 'bento',
        'udon', 'tempura', 'sashimi', 'nigiri', 'salmon', 'tuna', 'wagyu',
    ],
    food_safety: [
        'food poisoning', 'poisoning', 'got sick', 'made me sick', 'got ill',
        'vomiting', 'vomited', 'diarrhea', 'allergic reaction', 'allergen',
        'hospital', 'illness', 'contaminated', 'e. coli', 'salmonella',
        'roach', 'rodent', 'rat', 'mouse', 'bug in food', 'mold', 'hair in food',
    ],
};

const NEGATIVE_ASPECT_HINTS = {
    wait_time: ['slow', 'long', 'forever', 'waited', 'late'],
    service: ['ignored', 'forgot', 'refused'],
    food_quality: ['cold', 'lukewarm', 'undercooked', 'overcooked', 'stale', 'soggy'],
    price: ['expensive', 'overpriced', 'costly'],
    cleanliness: ['dirty', 'filthy', 'smell', 'roach', 'bug'],
    order_accuracy: ['wrong', 'missing', 'incorrect'],
    staff_attitude: ['rude', 'mean', 'aggressive', 'hostile', 'dismissive', 'sarcastic'],
};

function detectAspects(text, sentiment) {
    const lower = String(text || '').toLowerCase();
    const found = new Set();
    const detailScores = {};

    for (const [aspect, keywords] of Object.entries(ASPECT_KEYWORDS)) {
        for (const kw of keywords) {
            if (lower.includes(kw)) {
                found.add(aspect);
                detailScores[aspect] = (detailScores[aspect] || 0) + 1;
            }
        }
    }

    // If nothing detected, fall back to general classification using sentiment label
    if (found.size === 0) {
        const sentLabel = sentiment && sentiment.label ? sentiment.label : null;
        if (sentLabel === 'negative' || sentLabel === 'mixed') {
            found.add('general_negative');
        } else if (sentLabel === 'positive') {
            found.add('general_positive');
        } else {
            // neutral/unknown → still use sentiment score sign as fallback
            const score = sentiment && typeof sentiment.score === 'number' ? sentiment.score : 0;
            if (score < 0) found.add('general_negative');
            else if (score > 0) found.add('general_positive');
            else found.add('general_positive'); // truly neutral → assume general (default)
        }
    }

    // Sort by frequency desc
    const sorted = [...found].sort((a, b) => (detailScores[b] || 0) - (detailScores[a] || 0));
    return sorted;
}

module.exports = { detectAspects, ASPECT_KEYWORDS, NEGATIVE_ASPECT_HINTS };