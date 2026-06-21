/**
 * Generate TRACE_SUBMISSION_44.json and TRACE_SUBMISSION_40.json
 * Pulls ALL data from the database — raw OCR, memory, decision engine, vision, final reply.
 */
const db = require('../src/database');
const fs = require('fs');
const path = require('path');
const storeKnowledge = require('../src/storeKnowledge');

const ACCURATE_B2 = require('../data/acceptance/B2_stoneoak_4pm.json');
const ACCURATE_B3 = require('../data/acceptance/B3_bandera_4pm.json');

async function main() {
    await db.getDb();

    function buildTrace(submissionId, storeCode, groundTruth) {
        const sub = db.getOne('SELECT * FROM food_safety_submissions WHERE id = ' + submissionId);
        if (!sub) { console.error('Submission ' + submissionId + ' not found'); process.exit(1); }

        const audits = db.getAll('SELECT * FROM ceo_runtime_prediction_audit WHERE submission_id = ' + submissionId + ' ORDER BY id');
        const items = JSON.parse(sub.detected_items);
        const knowledge = storeKnowledge.getStoreKnowledge(storeCode);

        // Check vision review log
        let visionLogs = [];
        try {
            visionLogs = db.getAll("SELECT * FROM vision_review_log WHERE submission_id = '" + submissionId + "'");
        } catch (_) { /* table may not exist */ }

        // Check pipeline traces
        let pipelineTraces = [];
        try {
            pipelineTraces = db.getAll("SELECT step, status, output_summary FROM pipeline_trace_events WHERE submission_id = '" + submissionId + "' ORDER BY id");
        } catch (_) { }

        // Build audit lookup by field_id
        const auditMap = {};
        audits.forEach(a => { auditMap[a.field_id] = a; });

        const visionLogMap = {};
        visionLogs.forEach(v => { visionLogMap[v.field_id] = v; });

        // Build field traces
        const fieldTraces = items.map(item => {
            const fieldId = item.field_id || item.id;
            const audit = auditMap[fieldId] || null;
            const fieldKnowledge = knowledge ? knowledge.fields.find(f => f.field_id === fieldId) : null;
            const visionLog = visionLogMap[fieldId] || null;
            const groundTruthValue = groundTruth[fieldId] !== undefined ? groundTruth[fieldId] : null;

            return {
                field: fieldId,
                label: item.label || item.item || fieldId,
                ground_truth: groundTruthValue,
                range: fieldKnowledge ? fieldKnowledge.range : [item.range_min, item.range_max],
                critical: fieldKnowledge ? fieldKnowledge.criticality === "critical" : false,
                ocr: audit ? audit.raw_ocr_value : (item._rawOcrValue !== undefined ? item._rawOcrValue : null),
                ocr_confidence: audit ? audit.raw_ocr_confidence : (item._rawOcrConfidence || item.confidence || 0),
                memory: audit ? audit.memory_top_value : null,
                memory_confidence: audit ? audit.memory_similarity : null,
                writer_profile: audit ? (audit.writer_memory_value || null) : null,
                store_knowledge: {
                    expected_range: fieldKnowledge ? fieldKnowledge.range[0] + "-" + fieldKnowledge.range[1] : "unknown",
                    critical: fieldKnowledge ? fieldKnowledge.criticality === "critical" : false,
                    typical_values: fieldKnowledge ? fieldKnowledge.typical_values : [],
                    common_bad_ocr: fieldKnowledge ? fieldKnowledge.common_bad_ocr_values : [],
                    requires_vision_review: fieldKnowledge ? fieldKnowledge.requires_vision_review : false
                },
                vision: visionLog ? visionLog.vision_value : null,
                vision_confidence: visionLog ? visionLog.vision_confidence : null,
                vision_override: visionLog ? (visionLog.should_override_ocr === 1) : null,
                vision_skipped_reason: !visionLog ? "VISION_REVIEW_DISABLED" : null,
                decision_engine_value: audit ? audit.final_value : item.detectedValue,
                decision_engine_source: audit ? audit.final_source : item._predictionSource,
                decision_engine_status: audit ? audit.final_status : null,
                decision_engine_alert_allowed: audit ? (audit.alert_allowed === 1) : null,
                decision_engine_block_reason: audit ? audit.alert_block_reason : null,
                final_reply_value: item.detectedValue,
                reply_source: audit ? "decision_engine" : ("memory_fallback:" + (item._predictionSource || "UNKNOWN"))
            };
        });

        return {
            trace_id: "TRACE_SUBMISSION_" + submissionId + "_" + storeCode,
            submission_id: submissionId,
            store_code: storeCode,
            store_name: sub.store_name,
            template_id: items[0] ? (items[0].template_id || "unknown") : "unknown",
            created_at: sub.created_at,
            ocr_confidence_overall: sub.ocr_confidence,
            status: sub.status,
            vision_enabled_runtime: process.env.VISION_REVIEW_ENABLED === "true",
            vision_provider_runtime: process.env.VISION_PROVIDER || "disabled",
            vision_review_log_exists: visionLogs.length > 0,
            pipeline_trace_recorded: pipelineTraces.length > 0,
            pipeline_steps: pipelineTraces.map(t => ({ step: t.step, status: t.status })),
            field_count: fieldTraces.length,
            fields: fieldTraces
        };
    }

    // Generate traces
    const trace44 = buildTrace(44, "B2", ACCURATE_B2);
    const trace40 = buildTrace(40, "B3", ACCURATE_B3);

    // Write files
    const outDir = path.join(__dirname, '..');
    fs.writeFileSync(path.join(outDir, 'TRACE_SUBMISSION_44.json'), JSON.stringify(trace44, null, 2));
    fs.writeFileSync(path.join(outDir, 'TRACE_SUBMISSION_40.json'), JSON.stringify(trace40, null, 2));

    console.log('Generated TRACE_SUBMISSION_44.json (' + trace44.fields.length + ' fields)');
    console.log('Generated TRACE_SUBMISSION_40.json (' + trace40.fields.length + ' fields)');

    // Print summary of impossible values
    console.log('\n=== IMPOSSIBLE VALUES CHECK ===');
    const impossiblePatterns = [9, 8, -9, 138, 1, 7, 138];
    [trace44, trace40].forEach(trace => {
        console.log('\n' + trace.trace_id + ':');
        trace.fields.forEach(f => {
            const val = f.final_reply_value;
            const ocr = f.ocr;
            const groundTruth = f.ground_truth;
            const issues = [];
            if (val !== null && val !== undefined) {
                if (f.range && (val < f.range[0] || val > f.range[1])) {
                    issues.push('OUT_OF_RANGE(final=' + val + ', range=' + f.range[0] + '-' + f.range[1] + ')');
                }
            }
            if (ocr !== null && ocr !== undefined && typeof ocr === 'number') {
                if (f.range && (ocr < f.range[0] - 50 || ocr > f.range[1] + 50)) {
                    issues.push('CATASTROPHIC_OCR(ocr=' + ocr + ')');
                }
            }
            if (issues.length > 0) {
                console.log('  ' + f.field + ': ' + issues.join(' | ') + ' | final=' + val + ' | ocr=' + ocr + ' | truth=' + groundTruth);
            }
        });
    });

    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
