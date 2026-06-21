/**
 * Runtime Trace Audit — Query DB for submissions 44 (B2) and 40 (B3)
 * and build the required TRACE JSON files.
 */
const db = require('../src/database');
const fs = require('fs');
const path = require('path');
const storeKnowledge = require('../src/storeKnowledge');

async function main() {
    await db.getDb();

    // Get submissions
    const sub44 = db.getOne('SELECT * FROM food_safety_submissions WHERE id = 44');
    const sub40 = db.getOne('SELECT * FROM food_safety_submissions WHERE id = 40');

    // Get prediction audits
    const audits44 = db.getAll('SELECT * FROM ceo_runtime_prediction_audit WHERE submission_id = 44 ORDER BY id');
    const audits40 = db.getAll('SELECT * FROM ceo_runtime_prediction_audit WHERE submission_id = 40 ORDER BY id');

    // Get pipeline traces
    const traces44 = db.getAll("SELECT * FROM pipeline_trace_events WHERE submission_id = '44' ORDER BY id");
    const traces40 = db.getAll("SELECT * FROM pipeline_trace_events WHERE submission_id = '40' ORDER BY id");

    // Get message logs for both chats
    const chatId44 = sub44 ? sub44.phone_number : '';
    const chatId40 = sub40 ? sub40.phone_number : '';
    const msgs44 = db.getAll('SELECT direction, substr(content,1,500) as content, message_type, created_at FROM message_log WHERE phone_number = ? ORDER BY id', [chatId44]);
    const msgs40 = db.getAll('SELECT direction, substr(content,1,500) as content, message_type, created_at FROM message_log WHERE phone_number = ? ORDER BY id', [chatId40]);

    console.log('\n========== SUBMISSION 44 (B2 Stone Oak) ==========');
    console.log('Store:', sub44.store_name);
    console.log('OCR Confidence:', sub44.ocr_confidence);
    console.log('Status:', sub44.status);
    console.log('Created:', sub44.created_at);
    console.log('\n--- Prediction Audits ---');
    audits44.forEach(a => {
        console.log(`  ${a.field_id}: ocr=${a.raw_ocr_value} ocr_conf=${a.raw_ocr_confidence} mem=${a.memory_top_value} mem_sim=${a.memory_similarity} final=${a.final_value} src=${a.final_source} status=${a.final_status} alert=${a.alert_allowed} block=${a.alert_block_reason}`);
    });

    console.log('\n--- Detected Items (post-decision) ---');
    const items44 = JSON.parse(sub44.detected_items);
    items44.forEach(i => {
        const dec = i._decision || {};
        console.log(`  ${i.id}: val=${i.detectedValue} src=${i._predictionSource} conf=${i.confidence} decision_src=${dec.prediction_source || 'NONE'} decision_final=${dec.final_suggested_value !== undefined ? dec.final_suggested_value : 'N/A'}`);
    });

    console.log('\n--- Pipeline Traces ---');
    traces44.forEach(t => {
        const out = t.output_summary ? JSON.parse(t.output_summary) : {};
        console.log(`  ${t.step}: ${t.status}`, JSON.stringify(out).substring(0, 200));
    });

    console.log('\n========== SUBMISSION 40 (B3 Bandera) ==========');
    console.log('Store:', sub40.store_name);
    console.log('OCR Confidence:', sub40.ocr_confidence);
    console.log('Status:', sub40.status);
    console.log('Created:', sub40.created_at);
    console.log('\n--- Prediction Audits ---');
    audits40.forEach(a => {
        console.log(`  ${a.field_id}: ocr=${a.raw_ocr_value} ocr_conf=${a.raw_ocr_confidence} mem=${a.memory_top_value} mem_sim=${a.memory_similarity} final=${a.final_value} src=${a.final_source} status=${a.final_status} alert=${a.alert_allowed} block=${a.alert_block_reason}`);
    });

    console.log('\n--- Detected Items (post-decision) ---');
    const items40 = JSON.parse(sub40.detected_items);
    items40.forEach(i => {
        const dec = i._decision || {};
        console.log(`  ${i.id}: val=${i.detectedValue} src=${i._predictionSource} conf=${i.confidence} decision_src=${dec.prediction_source || 'NONE'} decision_final=${dec.final_suggested_value !== undefined ? dec.final_suggested_value : 'N/A'}`);
    });

    console.log('\n--- Pipeline Traces ---');
    traces40.forEach(t => {
        const out = t.output_summary ? JSON.parse(t.output_summary) : {};
        console.log(`  ${t.step}: ${t.status}`, JSON.stringify(out).substring(0, 200));
    });

    // Check vision config
    console.log('\n========== VISION CONFIG ==========');
    console.log('VISION_REVIEW_ENABLED:', process.env.VISION_REVIEW_ENABLED || 'NOT SET');
    console.log('VISION_PROVIDER:', process.env.VISION_PROVIDER || 'NOT SET');

    // Check vision review log
    const visionLogs44 = db.getAll("SELECT * FROM vision_review_log WHERE submission_id = '44'");
    const visionLogs40 = db.getAll("SELECT * FROM vision_review_log WHERE submission_id = '40'");
    console.log('Vision logs for sub44:', visionLogs44.length);
    console.log('Vision logs for sub40:', visionLogs40.length);
    visionLogs44.forEach(v => console.log(`  ${v.field_id}: ocr=${v.ocr_value} vision=${v.vision_value} conf=${v.vision_confidence} override=${v.should_override_ocr}`));
    visionLogs40.forEach(v => console.log(`  ${v.field_id}: ocr=${v.ocr_value} vision=${v.vision_value} conf=${v.vision_confidence} override=${v.should_override_ocr}`));

    // Check what the actual WhatsApp reply was
    console.log('\n========== OUTGOING MESSAGES ==========');
    const outMsgs44 = msgs44.filter(m => m.direction === 'out');
    const outMsgs40 = msgs40.filter(m => m.direction === 'out');
    console.log(`Sub44 outgoing messages: ${outMsgs44.length}`);
    outMsgs44.forEach(m => console.log(`  [${m.created_at}] ${m.content.substring(0, 400)}`));
    console.log(`Sub40 outgoing messages: ${outMsgs40.length}`);
    outMsgs40.forEach(m => console.log(`  [${m.created_at}] ${m.content.substring(0, 400)}`));

    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
