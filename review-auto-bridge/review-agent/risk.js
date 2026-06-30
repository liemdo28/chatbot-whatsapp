// Risk classifier — determines whether a review can be auto-replied,
// requires manager approval, or must be escalated.
// Implements CEO directive classification rules.

const ESCALATION_KEYWORDS = [
    // Health/safety
    'food poisoning', 'poisoning', 'got sick', 'made me sick', 'got ill',
    'vomiting', 'vomited', 'diarrhea', 'allergic reaction', 'hospital',
    'illness', 'contaminated', 'e. coli', 'salmonella',
    // Safety
    'unsafe', 'safety issue', 'safety concern', 'health hazard',
    'roach', 'rodent', 'rat', 'mouse', 'bug in food', 'mold',
    // Discrimination / harassment
    'discrimination', 'discriminated', 'racist', 'racism', 'harassment',
    'sexist', 'homophobic', 'transphobic',
    // Legal / financial
    'lawsuit', 'lawyer', 'legal action', 'sue', 'suing',
    'chargeback', 'fraud', 'stolen', 'theft',
    // Severe service
    'assault', 'physical', 'threatened', 'violence', 'abusive',
];

const APPROVAL_KEYWORDS = [
    'waited', 'long wait', 'slow service', 'slow', 'late',
    'cold food', 'lukewarm', 'undercooked', 'overcooked', 'bland', 'salty',
    'rude', 'unfriendly', 'dismissive', 'ignored',
    'dirty', 'filthy', 'unclean', 'smell',
    'overpriced', 'expensive', 'too much',
    'wrong order', 'missing item', 'forgot', 'incorrect',
    'refund', 'charged', 'billing',
    'delivery', 'doordash', 'uber eats',
    'sick', // mild — not full escalation unless paired with other words
];

const SOFT_POSITIVE_KEYWORDS = [
    'good', 'nice', 'ok', 'okay', 'fine', 'decent',
];

function classifyRisk({ rating, reviewText, sentiment, aspects }) {
    const text = String(reviewText || '').toLowerCase();
    const hits = { escalation: [], approval: [] };

    for (const kw of ESCALATION_KEYWORDS) {
        if (text.includes(kw)) hits.escalation.push(kw);
    }
    for (const kw of APPROVAL_KEYWORDS) {
        if (text.includes(kw)) hits.approval.push(kw);
    }

    // Tier 1: escalation (1-2 stars + escalation keywords)
    if (rating <= 2 && hits.escalation.length > 0) {
        return {
            risk_level: 'escalation_required',
            auto_reply_allowed: false,
            requires_approval: true,
            reason: `Escalation: rating ${rating}★ + critical keyword(s): ${hits.escalation.join(', ')}`,
            escalation_flags: hits.escalation,
            approval_flags: hits.approval,
        };
    }

    // Tier 1b: any rating with strong escalation keyword
    if (hits.escalation.length > 0) {
        return {
            risk_level: 'escalation_required',
            auto_reply_allowed: false,
            requires_approval: true,
            reason: `Critical escalation keyword(s): ${hits.escalation.join(', ')}`,
            escalation_flags: hits.escalation,
            approval_flags: hits.approval,
        };
    }

    // Tier 2: 1-2 stars → escalation by default
    if (rating <= 2) {
        return {
            risk_level: 'escalation_required',
            auto_reply_allowed: false,
            requires_approval: true,
            reason: `${rating}★ review — low rating requires escalation`,
            escalation_flags: [`low_rating_${rating}`],
            approval_flags: hits.approval,
        };
    }

    // Tier 3: 3 stars → approval required
    if (rating === 3) {
        return {
            risk_level: 'approval_required',
            auto_reply_allowed: false,
            requires_approval: true,
            reason: `3-star mixed review — manager approval needed${hits.approval.length ? ' (has complaint keywords)' : ''}`,
            escalation_flags: [],
            approval_flags: hits.approval,
        };
    }

    // Tier 4: 4-5 stars + approval keywords → approval required (complaint in positive)
    if (rating >= 4 && hits.approval.length > 0) {
        return {
            risk_level: 'approval_required',
            auto_reply_allowed: false,
            requires_approval: true,
            reason: `${rating}★ review but contains complaint keyword(s): ${hits.approval.slice(0, 3).join(', ')}`,
            escalation_flags: [],
            approval_flags: hits.approval,
        };
    }

    // Tier 5: 4-5 stars, sentiment conflicts with rating → approval
    if (rating >= 4 && sentiment?.label === 'negative') {
        return {
            risk_level: 'approval_required',
            auto_reply_allowed: false,
            requires_approval: true,
            reason: `${rating}★ rating but negative sentiment — needs review`,
            escalation_flags: [],
            approval_flags: ['sentiment_mismatch'],
        };
    }

    // Tier 6: 4-5 stars, sentiment low confidence → approval
    if (rating >= 4 && sentiment?.confidence < 0.3) {
        return {
            risk_level: 'approval_required',
            auto_reply_allowed: false,
            requires_approval: true,
            reason: `${rating}★ review but sentiment analysis low confidence — needs review`,
            escalation_flags: [],
            approval_flags: ['low_confidence'],
        };
    }

    // Tier 7: 4-5 stars, clean positive → AUTO
    return {
        risk_level: 'auto_allowed',
        auto_reply_allowed: true,
        requires_approval: false,
        reason: `${rating}★ clean positive review — auto-reply safe`,
        escalation_flags: [],
        approval_flags: [],
    };
}

module.exports = { classifyRisk, ESCALATION_KEYWORDS, APPROVAL_KEYWORDS };