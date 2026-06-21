#!/usr/bin/env node
/**
 * patch-vlm-safety.js — CTO DIRECTIVE: Vision Safety Reintegration
 *
 * Patches foodSafetyHandler.js to replace VLM_SHORTCIRCUIT with
 * the safety-integrated path (Store Knowledge → Decision Engine → Reply Builder).
 *
 * Run: cd whatsapp-ai-gateway && node tools/patch-vlm-safety.js
 */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "src", "foodSafetyHandler.js");
const BACKUP = FILE + ".pre-safety-backup";

let content = fs.readFileSync(FILE, "utf8");
console.log("File size:", content.length, "chars");

// Backup
fs.copyFileSync(FILE, BACKUP);
console.log("Backed up to:", BACKUP);

// ─── STEP 1: Add VLM_MIN_FIELD_CONFIDENCE constant ────────────────
if (!content.includes("VLM_MIN_FIELD_CONFIDENCE")) {
    content = content.replace(
        "const sessions = {};",
        "// VLM Blank Cell Guard: fields with confidence below this are treated as blank\nconst VLM_MIN_FIELD_CONFIDENCE = 0.30;\n\nconst sessions = {};"
    );
    console.log("STEP 1: Added VLM_MIN_FIELD_CONFIDENCE");
}

// ─── STEP 2: Add VLM safety functions ─────────────────────────────
if (!content.includes("function enrichVlmItemsWithStoreKnowledge")) {
    const marker = "function _buildVlmReply(parsed, storeInfo) {";
    const safetyFns = `
// ═══════════════════════════════════════════════════════════════════════
// VLM SAFETY LAYER — Vision LLM → Store Knowledge → Decision Engine
// ═══════════════════════════════════════════════════════════════════════

/**
 * Enrich VLM-extracted items with Store Knowledge safeRange.
 */
function enrichVlmItemsWithStoreKnowledge(parsed, storeInfo) {
    for (const item of parsed.items || []) {
        const fieldId = item.field_id || item.id;
        const fieldKnowledge = storeKnowledge.getFieldKnowledge(storeInfo.storeCode, fieldId);
        if (fieldKnowledge) {
            item.safeRange = { min: fieldKnowledge.range[0], max: fieldKnowledge.range[1] };
            item.range_min = fieldKnowledge.range[0];
            item.range_max = fieldKnowledge.range[1];
            item.label = item.label || fieldKnowledge.label;
        }
    }
    return parsed;
}

/**
 * Blank Cell Guard for Vision LLM output.
 * Nullifies hallucinated values for cells that are genuinely blank.
 */
function vlmBlankCellGuard(parsed) {
    for (const item of parsed.items || []) {
        const value = item.detectedValue;
        if (value === null || value === undefined) continue;
        const notes = String(item._visionNotes || "").toLowerCase();
        const isBlankNote = /\\b(blank|empty|illegible|missing|not\\s*visible|no\\s*data|unclear)\\b/i.test(notes);
        const lowConfidence = (item.confidence || 0) < VLM_MIN_FIELD_CONFIDENCE;
        if (isBlankNote || lowConfidence) {
            logger.info("[VLM_BLANK_GUARD] Nullified VLM value", {
                fieldId: item.field_id || item.id,
                reason: isBlankNote ? "BLANK_NOTE" : "LOW_CONFIDENCE",
                originalValue: value, confidence: item.confidence,
            });
            item.detectedValue = null;
            item.value = null;
            item._needsConfirmation = true;
            item._predictionSource = "VLM_BLANK_GUARD";
        }
    }
    return parsed;
}

`;
    const idx = content.indexOf(marker);
    if (idx !== -1) {
        content = content.slice(0, idx) + safetyFns + content.slice(idx);
        console.log("STEP 2: Added enrichVlmItemsWithStoreKnowledge + vlmBlankCellGuard");
    } else {
        console.error("STEP 2 FAILED: Cannot find _buildVlmReply marker");
    }
}

// ─── STEP 3: Replace VLM_SHORTCIRCUIT ─────────────────────────────
// Find and replace the shortcircuit comment block
const shortcircuitStart = "    // ─── VISION LLM SHORTCIRCUIT ────────────────────────────────────";
const legacyPathStart = "    // ─── LEGACY PATH (only when VLM not active) ────────────────────";

const scIdx = content.indexOf(shortcircuitStart);
const legacyIdx = content.indexOf(legacyPathStart);

if (scIdx !== -1 && legacyIdx !== -1 && !content.includes("VLM SAFETY-INTEGRATED PATH")) {
    // Replace from shortcircuit comment to just before legacy path
    const before = content.slice(0, scIdx);
    const after = content.slice(legacyIdx);

    const safetyPath = `    // ═══════════════════════════════════════════════════════════════
    // CTO DIRECTIVE: VLM SAFETY-INTEGRATED PATH
    // Image → Vision LLM → Store Knowledge → Decision Engine → Reply Builder → WhatsApp
    // Vision LLM PROPOSES. Decision Engine APPROVES.
    // One image → one Vision LLM call → one reply.
    // ═══════════════════════════════════════════════════════════════
    const vlmActive = fullOCR.ocrMethod === "VISION_LLM";
    if (vlmActive) {
        logger.info("[VLM_SAFETY] Entering safety-integrated path", {
            store: storeInfo.storeCode,
            readings: fullOCR.parsed.items ? fullOCR.parsed.items.length : 0,
        });

        // ── Step 1: Store Knowledge Validation ────────────────────
        enrichVlmItemsWithStoreKnowledge(fullOCR.parsed, storeInfo);
        pipelineTrace.step(trace, "STORE_KNOWLEDGE_DONE", "SUCCESS", {
            input_summary: { store_code: storeInfo.storeCode },
            output_summary: {
                store_name: storeInfo.storeName,
                fields_enriched: (fullOCR.parsed.items || []).length,
            },
        });

        // ── Step 2: Blank Cell Guard ─────────────────────────────
        vlmBlankCellGuard(fullOCR.parsed);
        rebuildIssues(fullOCR.parsed);

        // ── Step 3: Decision Engine (THE AUTHORITY) ───────────────
        const columnLabel = fullOCR.parsed.selected_column === "10:00" ? "10AM"
            : fullOCR.parsed.selected_column === "16:00" ? "4PM" : null;
        let vlmDecisionResult = null;
        try {
            vlmDecisionResult = decideFormValues(
                fullOCR.parsed.items, storeInfo.storeCode,
                null, columnLabel, fullOCR.ocrConfidence
            );
            fullOCR.parsed.items = vlmDecisionResult.items;
            rebuildIssues(fullOCR.parsed);
        } catch (err) {
            logger.warn("[VLM_SAFETY] Decision Engine failed", { error: err.message });
            rebuildIssues(fullOCR.parsed);
        }
        pipelineTrace.step(trace, "DECISION_ENGINE_DONE", vlmDecisionResult ? "SUCCESS" : "SKIPPED", {
            input_summary: { store_code: storeInfo.storeCode, column_label: columnLabel },
            output_summary: vlmDecisionResult ? vlmDecisionResult.summary : { reason: "FALLBACK" },
        });

        // Skip legacy layers that don't apply to VLM
        pipelineTrace.step(trace, "MEMORY_DONE", "SKIPPED", { output_summary: { reason: "VLM_SAFETY_PATH" } });
        pipelineTrace.step(trace, "WRITER_PROFILE_DONE", "SKIPPED", { output_summary: { reason: "VLM_SAFETY_PATH" } });
        pipelineTrace.step(trace, "VISION_REVIEW_DONE", "SKIPPED", { output_summary: { reason: "VLM_IS_THE_VISION" } });

        // ── Step 4: Alert Composer ───────────────────────────────
        let vlmAlertPayload = null;
        try {
            vlmAlertPayload = alertComposer.composeAlertPayload({
                submissionId: "pending", storeCode: storeInfo.storeCode,
                storeName: storeInfo.storeName, items: fullOCR.parsed.items || [],
                selectedColumn: columnLabel, lang: session.language,
            });
            pipelineTrace.step(trace, "ALERT_COMPOSER_DONE", "SUCCESS", {
                output_summary: { alert_would_send: !!vlmAlertPayload },
            });
        } catch (err) {
            pipelineTrace.step(trace, "ALERT_COMPOSER_DONE", "SKIPPED", {
                output_summary: { reason: "ALERT_COMPOSER_ERROR" },
            });
        }

        // ── Step 5: Reply Builder ────────────────────────────────
        const vlmReplyMsg = _buildVlmReply(fullOCR.parsed, storeInfo);
        pipelineTrace.step(trace, "REPLY_BUILDER_DONE", "SUCCESS", {
            output_summary: { builder: "_buildVlmReply", reply_chars: vlmReplyMsg.length },
        });

        // ── Step 6: Database Write ───────────────────────────────
        const vlmConfidence = (fullOCR.parsed.confidence || 0);
        fullOCR.parsed.status = "PENDING";
        const ocrJson = buildOcrJson(fullOCR.rawText, fullOCR.parsed, {
            ocr_method: "VISION_LLM", evidence_count: evidenceImages.length,
            trace_id: trace && trace.trace_id ? trace.trace_id : null,
        });
        const submissionId = db.insertSubmission({
            store_name: storeInfo.storeName, phone_number: phone,
            employee_name: null, message_id: getMessageId(formCandidate.message),
            trace_id: trace && trace.trace_id ? trace.trace_id : null,
            image_path: formCandidate.imagePath, ocr_raw_text: fullOCR.rawText,
            ocr_json: ocrJson, ocr_confidence: vlmConfidence,
            detected_items: JSON.stringify(fullOCR.parsed.items || []),
            status: "PENDING", language: session.language,
        });
        pipelineTrace.setSubmissionId(trace, submissionId);
        pipelineTrace.step(trace, "DB_WRITE_DONE", "SUCCESS", {
            output_summary: { submission_id: submissionId },
        });

        // ── Step 7: Build pending submission ──────────────────────
        const pending = {
            id: submissionId, parsed: fullOCR.parsed,
            imagePath: formCandidate.imagePath, rawText: fullOCR.rawText,
            ocrJson, storeName: storeInfo.storeName, storeCode: storeInfo.storeCode,
            ocrConfidence: vlmConfidence, predictionResult: null,
            manualRequired: !vlmDecisionResult || vlmDecisionResult.summary.manual_required > 0,
            evidenceImages, duplicateSuspicion: false,
        };
        session.pendingSubmission = pending;
        session.waitingFor = "action";
        session.storeCode = storeInfo.storeCode;
        session.ocrMethod = "VISION_LLM";

        // ── Step 8: Send reply (ONE reply per image) ──────────────
        const reply = pipelineTrace.appendFooter(vlmReplyMsg, trace);
        db.logMessage(phone, "in", "[image batch " + imageEntries.length + "]", "image");
        db.logMessage(phone, "out", reply, "text");

        // ── Step 9: Send alert if applicable ─────────────────────
        if (vlmAlertPayload) {
            try {
                alertComposer.sendConsolidatedAlert({
                    submissionId: String(submissionId), storeCode: storeInfo.storeCode,
                    storeName: storeInfo.storeName, items: fullOCR.parsed.items || [],
                    selectedColumn: columnLabel, lang: session.language,
                }).catch(() => {});
            } catch (_) {}
        }

        // ── Step 10: Pilot metrics ───────────────────────────────
        try {
            pilot.recordPilotSubmission({
                submissionId: String(submissionId), storeCode: storeInfo.storeCode,
                storeName: storeInfo.storeName, templateId: fullOCR.parsed.template_id,
                selectedColumn: fullOCR.parsed.selected_column,
                ocrConfidence: vlmConfidence, finalStatus: "PENDING",
                processingTimeMs: Date.now() - batchStartTime,
            });
        } catch (_) {}

        return reply;
    }

`;
    content = before + safetyPath + after;
    console.log("STEP 3: Replaced VLM_SHORTCIRCUIT with VLM SAFETY-INTEGRATED PATH");
} else {
    console.log("STEP 3: Shortcircuit block not found or already patched (scIdx=" + scIdx + " legacyIdx=" + legacyIdx + ")");
}

// ─── Write result ─────────────────────────────────────────────────
fs.writeFileSync(FILE, content, "utf8");
console.log("\nFinal file size:", content.length, "chars");
console.log("Has VLM_MIN_FIELD_CONFIDENCE:", content.includes("VLM_MIN_FIELD_CONFIDENCE"));
console.log("Has enrichVlmItemsWithStoreKnowledge:", content.includes("function enrichVlmItemsWithStoreKnowledge"));
console.log("Has vlmBlankCellGuard:", content.includes("function vlmBlankCellGuard"));
console.log("Has VLM_SAFETY:", content.includes("VLM_SAFETY"));
console.log("Has VLM_SHORTCIRCUIT:", content.includes("VLM_SHORTCIRCUIT"));
console.log("Has STORE_KNOWLEDGE_DONE:", content.includes("STORE_KNOWLEDGE_DONE"));
console.log("Has DECISION_ENGINE_DONE:", content.includes("DECISION_ENGINE_DONE"));
console.log("Has REPLY_BUILDER_DONE:", content.includes("REPLY_BUILDER_DONE"));
console.log("\nDone!");
