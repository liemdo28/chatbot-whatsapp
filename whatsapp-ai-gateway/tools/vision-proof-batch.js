require('dotenv').config();
const db = require('../src/database');
const fs = require('fs');
const path = require('path');
const visionAi = require('../src/visionAiReviewer');
const storeKnowledge = require('../src/storeKnowledge');
const { decideFieldValue } = require('../src/foodSafetyDecisionEngine');

const groundTruth = {
    44: require('../data/acceptance/B2_stoneoak_4pm.json'),
    40: require('../data/acceptance/B3_bandera_4pm.json'),
};

function json(target, obj) {
    fs.writeFileSync(target, JSON.stringify(obj, null, 2));
    console.log('WROTE', target);
}

async function main() {
    await db.getDb();
    visionAi.initVisionReviewTable();
    const results = {};

    for (const submissionId of [44, 40]) {
        const sub = db.getOne('SELECT id, store_name, ocr_confidence, image_path, detected_items, created_at FROM food_safety_submissions WHERE id = ' + submissionId);
        if (!sub) throw new Error('Missing submission ' + submissionId);
        const items = JSON.parse(sub.detected_items);
        const storeCode = submissionId === 44 ? 'B2' : 'B3';
        const columnLabel = submissionId === 44 ? '4PM' : '4PM';
        const ctx = {
            imagePath: sub.image_path,
            storeCode,
            templateId: items[0]?.template_id || (submissionId === 44 ? 'FoodSafety-StoneOak-v3' : 'FoodSafety-Bandera-v3'),
            submissionId: String(submissionId),
            columnLabel,
        };

        const fieldTrace = [];
        const startTime = Date.now();
        const criticalFields = items.filter(i => {
            const fk = storeKnowledge.getFieldKnowledge(storeCode, i.field_id || i.id);
            return fk && fk.criticality === 'critical';
        }).slice(0, 6);
        const visionResults = await visionAi.reviewFields(criticalFields, ctx);

        for (const item of items) {
            const fieldId = item.field_id || item.id;
            const fk = storeKnowledge.getFieldKnowledge(storeCode, fieldId);
            const vision = visionResults[fieldId] || null;
            const decision = decideFieldValue({
                item: {
                    ...item,
                    _rawOcrValue: item._rawOcrValue ?? item.detectedValue,
                    _rawOcrConfidence: item._rawOcrConfidence ?? item.confidence ?? 0,
                },
                storeCode,
                writerName: null,
                columnLabel,
                ocrConfidence: sub.ocr_confidence || 0,
            });

            fieldTrace.push({
                field_id: fieldId,
                ocr_value: item._rawOcrValue ?? item.detectedValue,
                ocr_confidence: item._rawOcrConfidence ?? item.confidence ?? 0,
                memory_value: item._memoryValue ?? null,
                memory_confidence: item._memoryConfidence ?? null,
                writer_value: null,
                store_knowledge_range: fk ? fk.range : null,
                vision_called: !!vision,
                vision_provider: vision ? (process.env.VISION_PROVIDER || 'openai') : null,
                vision_model: vision ? (process.env.OPENAI_VISION_MODEL || 'gpt-4o') : null,
                vision_value: vision ? vision.vision_value : null,
                vision_confidence: vision ? vision.vision_confidence : null,
                decision_value: decision.final_suggested_value,
                final_value: decision.final_suggested_value,
                final_source: decision.prediction_source,
                ground_truth: groundTruth[submissionId]?.[fieldId] ?? null,
            });
        }

        results[submissionId] = {
            submission_id: submissionId,
            store_code: storeCode,
            image_path: sub.image_path,
            created_at: sub.created_at,
            vision_latency_ms: Date.now() - startTime,
            fields: fieldTrace,
        };
    }

    json(path.join(__dirname, '..', 'VISION_RUNTIME_TRACE_44.json'), results[44]);
    json(path.join(__dirname, '..', 'VISION_RUNTIME_TRACE_40.json'), results[40]);

    // Print before/after for OCR failures
    const failures = [
        { id: 44, field: 'SO-08' },
        { id: 44, field: 'SO-09' },
        { id: 44, field: 'SO-10' },
        { id: 40, field: 'BAN-16' },
        { id: 40, field: 'BAN-17' },
        { id: 44, field: 'SO-04' },
        { id: 44, field: 'SO-17' },
    ];
    console.log('\n=== VISION CORRECTION PROOF ===');
    for (const f of failures) {
        const field = results[f.id]?.fields.find(x => x.field_id === f.field);
        if (!field) continue;
        console.log(`\nFIELD: ${field.field_id}`);
        console.log('OCR:', field.ocr_value);
        console.log('Memory:', field.memory_value);
        console.log('Vision:', field.vision_value);
        console.log('Decision:', field.decision_value);
        console.log('Final:', field.final_value);
        console.log('Source:', field.final_source);
        console.log('Ground Truth:', field.ground_truth);
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
