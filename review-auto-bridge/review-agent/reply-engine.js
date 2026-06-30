// Human-tone reply engine — generates restaurant review replies
// that sound natural, not robotic, and address the customer's actual content.
//
// Style rules:
// 1. Thank the customer naturally (not "Thank you for your feedback.")
// 2. Mention the exact issue or praise
// 3. Apologize only when needed
// 4. Do not overpromise
// 5. Mention team will review/improve when appropriate
// 6. Invite the customer back naturally
// 7. Avoid robotic phrases
//
// Adapted from public restaurant-review best-practice guidelines.

const ROBOTIC_PHRASES = [
    'we value your feedback',
    'we apologize for the inconvenience',
    'your satisfaction is our priority',
    'thank you for your patronage',
    'we strive to provide',
    'we take this seriously',
    'your feedback is important to us',
    'we would like to apologize',
    'at our establishment',
    'to better serve you',
    'a valued customer',
];

function detectMentionedItems(text, menuItems) {
    const lower = String(text || '').toLowerCase();
    const mentioned = [];
    for (const item of menuItems) {
        if (lower.includes(String(item).toLowerCase())) {
            mentioned.push(item);
        }
    }
    return mentioned;
}

function detectPositiveHighlights(text, sentiment) {
    const lower = String(text || '').toLowerCase();
    const highlights = [];
    const highlightWords = ['amazing', 'great', 'excellent', 'fantastic', 'delicious', 'loved', 'love', 'best', 'perfect', 'wonderful', 'awesome', 'incredible'];
    for (const w of highlightWords) {
        if (lower.includes(w)) highlights.push(w);
    }
    return highlights.slice(0, 2);
}

function detectSpecificComplaints(text) {
    const lower = String(text || '').toLowerCase();
    const complaints = [];
    const complaintMap = [
        { kw: ['waited', 'long wait', 'slow'], aspect: 'wait_time', phrase: 'the wait was longer than it should have been' },
        { kw: ['cold', 'lukewarm'], aspect: 'food_quality', phrase: 'the dish didn\'t come out as hot as it should have' },
        { kw: ['undercooked', 'overcooked'], aspect: 'food_quality', phrase: 'the cooking wasn\'t quite right' },
        { kw: ['rude', 'unfriendly', 'ignored', 'dismissive'], aspect: 'staff_attitude', phrase: 'the service didn\'t feel welcoming' },
        { kw: ['dirty', 'filthy', 'smell'], aspect: 'cleanliness', phrase: 'the cleanliness wasn\'t up to par' },
        { kw: ['overpriced', 'expensive'], aspect: 'price', phrase: 'the price felt high for what was offered' },
        { kw: ['wrong order', 'missing item', 'missing items', 'forgot my'], aspect: 'order_accuracy', phrase: 'the order wasn\'t quite right' },
        { kw: ['delivery', 'doordash', 'uber eats'], aspect: 'delivery', phrase: 'the delivery experience fell short' },
        { kw: ['slow', 'long', 'forever'], aspect: 'service', phrase: 'things took longer than expected' },
    ];

    for (const m of complaintMap) {
        for (const kw of m.kw) {
            if (lower.includes(kw)) {
                complaints.push(m);
                break;
            }
        }
    }
    return complaints;
}

function generateReply({ rating, reviewText, reviewerName, storeMemory, sentiment, aspects, riskLevel }) {
    const text = String(reviewText || '').trim();
    const name = reviewerName ? reviewerName.trim() : null;
    const signature = storeMemory?.reply_signature || `${storeMemory?.brand_name || 'Our'} Team`;
    const storeName = storeMemory?.store_name || 'our restaurant';
    const menuItems = storeMemory?.common_menu_items || [];
    const tone = storeMemory?.tone_style || 'friendly, honest, not corporate';

    const greeting = name ? `Hi ${name},` : 'Hi there,';

    // ──── ESCALATION PATH: serious reviews, brief and human ────
    if (riskLevel === 'escalation_required') {
        return {
            draft_reply: `${greeting}\n\nThank you for letting us know about this. This isn't the experience we want anyone to have, and we take it seriously. We'd like the chance to learn more and make it right — could you reach out to us directly so we can follow up personally?\n\n— ${signature}`,
            requires_approval: true,
            reason: 'Escalation review — brief, human, defers to manager follow-up (no auto-post)',
            tone_used: 'escalation_brief',
        };
    }

    // ──── AUTO/POSITIVE PATH ────
    if (rating >= 4 && riskLevel === 'auto_allowed') {
        const mentionedItems = detectMentionedItems(text, menuItems);
        const highlights = detectPositiveHighlights(text, sentiment);

        let detail = '';
        if (mentionedItems.length > 0) {
            const itemList = mentionedItems.slice(0, 2).join(' and ');
            detail = `I'm really glad the ${itemList} hit the spot`;
        } else if (highlights.length > 0) {
            detail = `${highlights[0][0].toUpperCase() + highlights[0].slice(1)} to hear that`;
        } else {
            detail = 'Thanks for spending time with us';
        }

        const invite = `\n\nWe hope we get another chance to take care of you soon — come back and see us anytime.\n\n— ${signature}`;
        const body = `${detail}. ${name ? 'Thanks for coming in and for the kind words.' : 'Thanks for coming in and for the kind words.'}`;
        return {
            draft_reply: `${greeting}\n\n${body}${invite}`,
            requires_approval: false,
            reason: `${rating}★ positive review — auto-reply drafted (human tone, mentions specific items)`,
            tone_used: tone,
            mentioned_items: mentionedItems,
        };
    }

    // ──── APPROVAL/MIXED/NEGATIVE PATH ────
    if (rating <= 3 || riskLevel === 'approval_required') {
        const complaints = detectSpecificComplaints(text);
        const mentionedItems = detectMentionedItems(text, menuItems);

        // Build apology segment based on detected complaints
        let apologyParts = [];
        for (const c of complaints.slice(0, 2)) {
            apologyParts.push(c.phrase);
        }

        let acknowledgePraise = '';
        if (mentionedItems.length > 0 && (rating === 3 || sentiment?.positive > 0)) {
            acknowledgePraise = `I'm glad the ${mentionedItems[0]} was good`;
        }

        let apology = '';
        if (apologyParts.length > 0) {
            apology = `I'm sorry ${apologyParts.join(' and ')}. That's not the experience we want guests to have.`;
        } else if (rating <= 2) {
            apology = `I'm sorry your visit didn't go the way it should have.`;
        } else {
            apology = `Thanks for being honest with us.`;
        }

        let improvementLine = '';
        if (complaints.length > 0 || rating <= 2) {
            improvementLine = `We'll share this with the team so we can improve ${complaints[0]?.aspect ? complaints[0].aspect.replace('_', ' ') : 'on the areas you mentioned'}.`;
        }

        const invite = `We hope we get another chance to take better care of you next time.`;
        const bodyParts = [];
        if (acknowledgePraise) bodyParts.push(acknowledgePraise);
        bodyParts.push(apology);
        if (improvementLine) bodyParts.push(improvementLine);
        bodyParts.push(invite);

        const body = bodyParts.join(' ');

        return {
            draft_reply: `${greeting}\n\n${body}\n\n— ${signature}`,
            requires_approval: true,
            reason: `${rating}★ review with ${complaints.length} complaint(s) detected — manager approval needed before sending`,
            tone_used: tone,
            detected_complaints: complaints.map(c => c.aspect),
            mentioned_items: mentionedItems,
        };
    }

    // Fallback (shouldn't reach here)
    return {
        draft_reply: `${greeting}\n\nThanks for taking the time to share this with us. We appreciate the feedback and hope to see you again soon.\n\n— ${signature}`,
        requires_approval: true,
        reason: 'Fallback — classification unclear, sending to approval',
        tone_used: tone,
    };
}

function qualityCheck(draft) {
    const issues = [];
    const lower = String(draft || '').toLowerCase();

    for (const phrase of ROBOTIC_PHRASES) {
        if (lower.includes(phrase)) {
            issues.push(`Contains robotic phrase: "${phrase}"`);
        }
    }

    if (!draft || draft.trim().length < 30) {
        issues.push('Reply too short (min 30 chars)');
    }
    if (draft && draft.length > 1000) {
        issues.push('Reply too long (max 1000 chars)');
    }

    return {
        passed: issues.length === 0,
        issues,
        length: draft ? draft.length : 0,
    };
}

module.exports = { generateReply, qualityCheck, ROBOTIC_PHRASES };