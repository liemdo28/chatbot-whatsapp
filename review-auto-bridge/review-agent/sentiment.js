// Lightweight sentiment engine — keyword + VADER-style scoring
// No external deps. Pattern adapted from open-source VADER reference (MIT)
// and tuned for restaurant-review domain.

const POSITIVE_LEXICON = {
    amazing: 3, excellent: 3, fantastic: 3, perfect: 3, wonderful: 3, loved: 3, love: 3,
    great: 2, good: 1.5, nice: 1.5, friendly: 2, fresh: 2, delicious: 3, tasty: 2,
    awesome: 3, best: 3, super: 1.5, lovely: 2, fast: 1.5, quick: 1.5, attentive: 2,
    kind: 1.5, helpful: 2, generous: 2, cozy: 1.5, beautiful: 2, clean: 1.5,
    exceeded: 2, recommend: 2, recommended: 2, enjoyed: 2, enjoy: 2, satisfied: 2,
    happy: 1.5, pleasure: 2, highlight: 2, gem: 3, outstanding: 3, phenomenal: 3,
    stellar: 3, incredible: 3, delightful: 2, warm: 1.5,
};

const NEGATIVE_LEXICON = {
    terrible: -3, horrible: -3, awful: -3, worst: -3, disgusting: -4, inedible: -4,
    bad: -2, poor: -2, slow: -1.5, cold: -2, lukewarm: -2, undercooked: -3,
    overcooked: -2, burnt: -3, stale: -3, rude: -3, dirty: -3, disgusting: -4,
    waited: -1, wait: -1, late: -1.5, expensive: -1.5, overpriced: -2, salty: -1.5, soggy: -2,
    disappointed: -2.5, disappointing: -2.5, meh: -1.5, 'no flavor': -2, flavorless: -2,
    refused: -2.5, ignored: -2.5, forgotten: -2, wrong: -2, missing: -2, missing: -2,
    sick: -3, poisoning: -4, illness: -3, hair: -3, roach: -4, bug: -3,
    discriminated: -4, harassment: -4, scam: -3, fraud: -3, manager: -1, refund: -2.5,
    chargeback: -3, lawsuit: -4, lawyer: -3,
};

const NEGATORS = new Set(['not', 'no', 'never', "n't", 'without', 'hardly', 'barely']);
const INTENSIFIERS = { very: 1.5, really: 1.4, super: 1.4, extremely: 1.8, totally: 1.4, absolutely: 1.8, quite: 1.2 };

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function analyzeSentiment(text) {
    const tokens = tokenize(text);
    if (tokens.length === 0) return { score: 0, positive: 0, negative: 0, confidence: 0 };

    let posScore = 0;
    let negScore = 0;
    let wordCount = 0;

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        const prev = tokens[i - 1] || '';
        const isNegated = NEGATORS.has(prev) || prev.endsWith("n't");
        const intensifier = INTENSIFIERS[prev] || 1;

        if (POSITIVE_LEXICON[tok] !== undefined) {
            let s = POSITIVE_LEXICON[tok] * intensifier;
            if (isNegated) s = -s * 0.7;
            if (s > 0) posScore += s; else negScore += s;
            wordCount++;
        } else if (NEGATIVE_LEXICON[tok] !== undefined) {
            let s = NEGATIVE_LEXICON[tok] * intensifier;
            if (isNegated) s = -s * 0.7;
            if (s < 0) negScore += s; else posScore += s;
            wordCount++;
        }
    }

    const rawScore = posScore + negScore;
    const normScore = Math.max(-1, Math.min(1, rawScore / Math.max(3, tokens.length / 2)));
    const confidence = Math.min(1, wordCount / Math.max(3, tokens.length * 0.3));

    let label = 'neutral';
    // Mixed-signal detection: "X but Y" patterns common in 3★ reviews
    const hasBut = /\bbut\b/i.test(String(text || ''));
    if (normScore >= 0.25 && (!hasBut || negScore === 0)) label = 'positive';
    else if (normScore <= -0.25 && (!hasBut || posScore === 0)) label = 'negative';
    else if (hasBut && posScore > 0 && negScore < 0) label = 'mixed';
    else if (posScore > 0 && negScore < 0 && Math.abs(normScore) > 0.1) label = 'mixed';

    return {
        label,
        score: Number(normScore.toFixed(3)),
        positive: Number(posScore.toFixed(2)),
        negative: Number(negScore.toFixed(2)),
        confidence: Number(confidence.toFixed(2)),
        token_count: tokens.length,
    };
}

module.exports = { analyzeSentiment, POSITIVE_LEXICON, NEGATIVE_LEXICON };