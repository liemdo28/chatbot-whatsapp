// Review Reply Agent Pipeline
// Flow: detect rating → sentiment → aspects → extract issue → classify risk →
//       generate human-tone reply → quality check → save audit log

const { analyzeSentiment } = require('./sentiment');
const { detectAspects } = require('./aspect');
const { classifyRisk } = require('./risk');
const { generateReply, qualityCheck } = require('./reply-engine');
const { getStoreMemory } = require('./store-memory');
const { writeAuditLog, saveDraft, saveApproval } = require('./audit');

function analyze({ store_id, platform, rating, review_text, reviewer_name }) {
    const r = parseInt(rating, 10);
    const text = String(review_text || '').trim();
    const sentiment = analyzeSentiment(text);
    const aspects = detectAspects(text, sentiment);
    const risk = classifyRisk({
        rating: r,
        reviewText: text,
        sentiment,
        aspects,
    });

    // Build summary
    const summary = buildSummary({ rating: r, sentiment, aspects, risk });

    return {
        rating: r,
        sentiment: sentiment.label,
        sentiment_detail: sentiment,
        aspects,
        risk_level: risk.risk_level,
        auto_reply_allowed: risk.auto_reply_allowed,
        requires_approval: risk.requires_approval,
        summary,
        risk_detail: risk,
    };
}

function buildSummary({ rating, sentiment, aspects, risk }) {
    const aspectList = aspects.slice(0, 3).join(', ') || 'general experience';
    const sentimentWord = sentiment.label;

    if (rating >= 4 && risk.risk_level === 'auto_allowed') {
        return `Customer gave ${rating}★ with positive sentiment about ${aspectList}. Safe for auto-reply.`;
    }
    if (rating === 3) {
        return `Customer gave ${rating}★ (${sentimentWord}) about ${aspectList}. Mixed review — needs approval.`;
    }
    if (rating <= 2) {
        return `Customer gave ${rating}★ with concerns about ${aspectList}. ${risk.escalation_flags?.length ? 'Critical keywords detected.' : 'Low rating — escalation needed.'}`;
    }
    return `Customer gave ${rating}★ about ${aspectList}. Status: ${risk.risk_level}.`;
}

function generate({ store_id, platform, rating, review_text, reviewer_name }) {
    const analysis = analyze({ store_id, platform, rating, review_text, reviewer_name });
    const storeMemory = getStoreMemory(store_id);

    const reply = generateReply({
        rating: analysis.rating,
        reviewText: review_text,
        reviewerName: reviewer_name,
        storeMemory,
        sentiment: analysis.sentiment_detail,
        aspects: analysis.aspects,
        riskLevel: analysis.risk_level,
    });

    const qc = qualityCheck(reply.draft_reply);

    return {
        analysis,
        draft_reply: reply.draft_reply,
        requires_approval: reply.requires_approval,
        reason: reply.reason,
        tone_used: reply.tone_used,
        mentioned_items: reply.mentioned_items || [],
        detected_complaints: reply.detected_complaints || [],
        quality_check: qc,
        store_memory_used: {
            store_id: storeMemory.store_id,
            store_name: storeMemory.store_name,
            brand_name: storeMemory.brand_name,
        },
    };
}

async function run({ store_id, platform, rating, review_text, reviewer_name, review_id }) {
    try {
        const generated = generate({ store_id, platform, rating, review_text, reviewer_name });

        // Save draft
        const draft = saveDraft({
            review_id,
            store_id,
            platform,
            rating,
            review_text,
            reviewer_name,
            sentiment: generated.analysis.sentiment,
            aspects: generated.analysis.aspects,
            risk_level: generated.analysis.risk_level,
            draft_reply: generated.draft_reply,
            requires_approval: generated.requires_approval,
            quality_check: generated.quality_check,
        });

        // If approval needed, save approval request
        let approval = null;
        if (generated.requires_approval) {
            approval = saveApproval({
                draft_id: draft.id,
                review_id,
                store_id,
                platform,
                rating,
                reviewer_name,
                review_text,
                suggested_reply: generated.draft_reply,
                detected_aspects: generated.analysis.aspects,
                detected_sentiment: generated.analysis.sentiment,
                risk_level: generated.analysis.risk_level,
                risk_reason: generated.reason,
                approval_message: formatApprovalMessage({
                    store_id, platform, rating, review_text, reviewer_name,
                    aspects: generated.analysis.aspects, draft: generated.draft_reply,
                }),
            });
        }

        // Audit log
        const audit = writeAuditLog({
            review_id,
            store_id,
            platform,
            rating,
            review_text,
            reviewer_name,
            detected_sentiment: generated.analysis.sentiment,
            detected_aspects: generated.analysis.aspects,
            risk_level: generated.analysis.risk_level,
            draft_reply: generated.draft_reply,
            auto_reply_allowed: !generated.requires_approval,
            approval_status: generated.requires_approval ? 'pending' : 'auto',
            approval_id: approval?.id || null,
            metadata: {
                tone_used: generated.tone_used,
                quality_check: generated.quality_check,
                mentioned_items: generated.mentioned_items,
                detected_complaints: generated.detected_complaints,
            },
        });

        return {
            ok: true,
            analysis: generated.analysis,
            draft_reply: generated.draft_reply,
            requires_approval: generated.requires_approval,
            reason: generated.reason,
            quality_check: generated.quality_check,
            approval_id: approval?.id || null,
            approval_message: approval?.approval_message || null,
            draft_id: draft.id,
            audit_id: audit.id,
        };
    } catch (err) {
        // Log error in audit
        writeAuditLog({
            review_id,
            store_id,
            platform,
            rating,
            review_text,
            reviewer_name,
            error_message: err.message,
            approval_status: 'error',
        });
        return {
            ok: false,
            error: err.message,
        };
    }
}

function formatApprovalMessage({ store_id, platform, rating, review_text, reviewer_name, aspects, draft }) {
    const aspectList = (aspects || []).map(a => `- ${a}`).join('\n');
    return [
        'New Review Reply Needs Approval',
        `Store: ${store_id}`,
        `Platform: ${platform}`,
        `Rating: ${rating} stars`,
        `Reviewer: ${reviewer_name || 'Anonymous'}`,
        `Review: "${review_text}"`,
        '',
        'Detected issues:',
        aspectList || '- (none detected)',
        '',
        'Suggested reply:',
        `"${draft}"`,
        '',
        'Reply:',
        '1 = Approve',
        '2 = Edit',
        '3 = Reject',
        '4 = Escalate',
    ].join('\n');
}

module.exports = { analyze, generate, run, buildSummary, formatApprovalMessage };