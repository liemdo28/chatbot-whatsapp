#!/usr/bin/env node
/**
 * apply-vlm-safety.js — CTO DIRECTIVE: Vision Safety Reintegration
 *
 * Generates the production foodSafetyHandler.js with VLM safety layers restored.
 * Vision-first architecture is preserved. Safety layers are re-integrated.
 *
 * Usage: node tools/apply-vlm-safety.js
 */
const fs = require("fs");
const path = require("path");

const TARGET = path.join(__dirname, "..", "src", "foodSafetyHandler.js");
const BACKUP = path.join(__dirname, "..", "src", "foodSafetyHandler.js.pre-safety-backup");

// Backup current file
if (fs.existsSync(TARGET)) {
    fs.copyFileSync(TARGET, BACKUP);
    console.log(`Backed up current file to ${BACKUP}`);
}

// Read original production file from backup or rebuild from known state
// The original file has the VLM_SHORTCIRCUIT at lines ~1005-1115
const original = fs.readFileSync(BACKUP, "utf8");
console.log(`Original file: ${original.length} chars`);

if (original.length < 15000) {
    console.error("ERROR: Backup file appears truncated. Cannot proceed safely.");
    process.exit(1);
}

let result = original;

// ═══════════════════════════════════════════════════════════════════════
// STEP 1: Add VLM_MIN_FIELD_CONFIDENCE constant
// ═══════════════════════════════════════════════════════════════════════
const constantMarker = "const AUTO_CONFIRM_ENABLED = String(process.env.FOOD_SAFETY_AUTO_CONFIRM_ENABLED";
const constantInsert = `// VLM Blank Cell Guard: fields with confidence below this are treated as blank
const VLM_MIN_FIELD_CONFIDENCE = 0.30;

`;
if (!result.includes("VLM_MIN_FIELD_CONFIDENCE")) {
    // Find the line after AUTO_CONFIRM_ENABLED
    const idx = result.indexOf("const sessions = {};");
    if (idx === -1) { console.error("Cannot find session init"); process.exit(1); }
    result = result.slice(0, idx) + constantInsert + result.slice(idx);
    console.log("STEP 1: Added VLM_MIN_FIELD_CONFIDENCE constant");
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 2: Add VLM safety functions after displayColumn
// ═══════════════════════════════════════════════════════════════════════
const safetyFunctions = `
// ═══════════════════════════════════════════════════════════════════════
// VLM SAFETY LAYER — Vision LLM → Store Knowledge → Decision Engine
// ═══════════════════════════════════════════════════════════════════════

/**
 * Enrich VLM-extracted items with Store Knowledge safeRange.
 * The Vision LLM bridge does not include range metadata — this fills it
 * from the authoritative store knowledge base.
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
 *
 * If the VLM returns a value but its per-field confidence is below
 * VLM_MIN_FIELD_CONFIDENCE, or the VLM notes indicate blank/empty/illegible,
 * we treat the cell as genuinely blank and preserve it as null.
 *
 * This prevents VLM hallucination from filling cells that are empty on
 * the physical form.
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
                originalValue: value,
                confidence: item.confidence,
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

const marker2 = "function _buildVlmReply(parsed, storeInfo) {";
if (!result.includes("function enrichVlmItemsWithStoreKnowledge")) {
    const idx2 = result.indexOf(marker2);
    if (idx2 === -1) { console.error("Cannot find _buildVlmReply"); process.exit(1); }
    result = result.slice(0, idx2) + safetyFunctions + result.slice(idx2);
    console.log("STEP 2: Added VLM safety functions (enrichVlmItemsWithStoreKnowledge, vlmBlankCellGuard)");
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 3: Replace the VLM_SHORTCIRCUIT block with safety-integrated path
// ═══════════════════════════════════════════════════════════════════════
const oldShortcircuit = `    // ─── VISION LLM SHORTCIRCUIT ────────────────────────────────────
    // When Vision LLM pipeline succeeds, it already did extraction + decision +
    // reply building. Skip ALL legacy middle layers (memory, writer profile,
    // cross-field, old vision reviewer, old decision engine).
    // One image → one Vision LLM call → one reply.
    const vlmActive = fullOCR.ocrMethod === "VISION_LLM";
    if (vlmActive) {
        logger.info("[VLM_SHORTCIRCUIT] Vision LLM extraction succeeded — bypassing legacy pipeline", {
            store: storeInfo.storeCode,
            readings: fullOCR.parsed.items ? fullOCR.parsed.items.length : 0,
        });
        pipelineTrace.step(trace, "MEMORY_DONE", "SKIPPED", {
            output_summary: { reason: "VLM_SHORTCIRCUIT", memory_used: false },
        });
        pipelineTrace.step(trace, "WRITER_PROFILE_DONE", "SKIPPED", {
            output_summary: { reason: "VLM_SHORTCIRCUIT" },
        });
        pipelineTrace.step(trace, "STORE_KNOWLEDGE_DONE", "SKIPPED", {
            output_summary: { reason: "VLM_SHORTCIRCUIT" },
        });
        pipelineTrace.step(trace, "VISION_REVIEW_DONE", "SKIPPED", {
            output_summary: { reason: "VLM_SHORTCIRCUIT" },
        });
        pipelineTrace.step(trace, "DECISION_ENGINE_DONE", "SKIPPED", {
            output_summary: { reason: "VLM_SHORTCIRCUIT" },
        });
        pipelineTrace.step(trace, "ALERT_COMPOSER_DONE", "SKIPPED", {
            output_summary: { reason: "VLM_SHORTCIRCUIT" },
        });
        pipelineTrace.step(trace, "REPLY_BUILDER_DONE", "SKIPPED", {
            output_summary: { reason: "VLM_SHORTCIRCUIT" },
        });

        // Use pipeline reply directly
        const vlmResult = fullOCR.parsed._visionLlmResult;
        const vlmReply = vlmResult && vlmResult.reply_text
            ? vlmResult.reply_text
            : _buildVlmReply(fullOCR.parsed, storeInfo);
        const vlmAlert = vlmResult && vlmResult.alert_text || null;

        const vlmConfidence = (fullOCR.parsed.confidence || 0);
        fullOCR.parsed.status = "PENDING";
        const ocrJson = buildOcrJson(fullOCR.rawText, fullOCR.parsed, {
            ocr_method: "VISION_LLM",
            evidence_count: evidenceImages.length,
            trace_id: trace && trace.trace_id ? trace.trace_id : null,
        });

        const submissionId = db.insertSubmission({
            store_name: storeInfo.storeName,
            phone_number: phone,
            employee_name: vlmResult ? vlmResult.employee_name : null,
            message_id: getMessageId(formCandidate.message),
            trace_id: trace && trace.trace_id ? trace.trace_id : null,
            image_path: formCandidate.imagePath,
            ocr_raw_text: fullOCR.rawText,
            ocr_json: ocrJson,
            ocr_confidence: vlmConfidence,
            detected_items: JSON.stringify(fullOCR.parsed.items || []),
            status: "PENDING",
            language: session.language,
        });
        pipelineTrace.setSubmissionId(trace, submissionId);
        pipelineTrace.step(trace, "DB_WRITE_DONE", "SUCCESS", {
            output_summary: { submission_id: submissionId },
        });

        const pending = {
            id: submissionId,
            parsed: fullOCR.parsed,
            imagePath: formCandidate.imagePath,
            rawText: fullOCR.rawText,
            ocrJson,
            storeName: storeInfo.storeName,
            storeCode: storeInfo.storeCode,
            ocrConfidence: vlmConfidence,
            predictionResult: null,
            manualRequired: false,
            evidenceImages,
            duplicateSuspicion: false,
        };
        session.pendingSubmission = pending;
        session.waitingFor = "action";
        session.storeCode = storeInfo.storeCode;
        session.ocrMethod = "VISION_LLM";

        const reply = pipelineTrace.appendFooter(vlmReply, trace);
        db.logMessage(phone, "in", \`[image batch \${imageEntries.length}]\`, "image");
        db.logMessage(phone, "out", reply, "text");

        // Send alert if pipeline produced one
        if (vlmAlert) {
            try {
                const alertComposer = require("./foodSafetyAlertComposer");
                alertComposer.sendConsolidatedAlert({
                    submissionId: String(submissionId),
                    storeCode: storeInfo.storeCode,
                    storeName: storeInfo.storeName,
                    items: fullOCR.parsed.items || [],
                    selectedColumn: fullOCR.parsed.selected_column,
                    lang: session.language,
                }).catch(() => { });
            } catch (_) { }
        }

        pipelineTrace.step(trace, "PILOT_METRIC_RECORDED", "SKIPPED", {
            output_summary: { reason: "VLM_SHORTCIRCUIT" },
        });

        return reply;
    }`;

const newSafetyPath = `    // ═══════════════════════════════════════════════════════════════
    // CTO DIRECTIVE: VLM SAFETY-INTEGRATED PATH
    //
    // Architecture:
    //   Image → Vision LLM → Store Knowledge → Decision Engine → Reply Builder → WhatsApp
    //
    // Vision LLM is the EXTRACTOR (replaces PaddleOCR as primary).
    // Store Knowledge is the SAFETY GUARD (range validation).
    // Decision Engine is the AUTHORITY (final value approval).
    // Reply Builder constructs the user-facing confirmation.
    //
    // One image → one Vision LLM call → one reply.
    // ═══════════════════════════════════════════════════════════════
    const vlmActive = fullOCR.ocrMethod === "VISION_LLM";
    if (vlmActive) {
        logger.info("[VLM_SAFETY] Vision LLM extraction succeeded — entering safety-integrated path", {
            store: storeInfo.storeCode,
            readings: fullOCR.parsed.items ? fullOCR.parsed.items.length : 0,
        });

        // ─── Step 1: Store Knowledge Validation ─────────────────────
        // Enrich VLM items with authoritative safeRange from store knowledge.
        // This is the FIRST safety gate — without ranges, nothing else works.
        enrichVlmItemsWithStoreKnowledge(fullOCR.parsed, storeInfo);
        pipelineTrace.step(trace, "STORE_KNOWLEDGE_DONE", "SUCCESS", {
            input_summary: { store_code: storeInfo.storeCode },
            output_summary: {
                store_name: storeInfo.storeName,
                fields_enriched: (fullOCR.parsed.items || []).length,
                critical_fields: storeKnowledge.getFieldsRequiringVisionReview(storeInfo.storeCode).map((f) => f.field_id),
            },
        });

        // ─── Step 2: Blank Cell Guard ──────────────────────────────
        // Nullify VLM hallucinated values for cells that are genuinely blank.
        vlmBlankCellGuard(fullOCR.parsed);
        rebuildIssues(fullOCR.parsed);

        // ─── Step 3: Decision Engine (THE AUTHORITY) ────────────────
        // Vision LLM PROPOSED values. Only the Decision Engine may APPROVE.
        // This blocks impossible values, validates fryer ranges, preserves
        // freezer negatives, and respects blank cells.
        const columnLabel = fullOCR.parsed.selected_column === "10:00" ? "10AM"
            : fullOCR.parsed.selected_column === "16:00" ? "4PM" : null;
        let vlmDecisionResult = null;
        try {
            vlmDecisionResult = decideFormValues(
                fullOCR.parsed.items,
                storeInfo.storeCode,
                null, // writerName — not known from VLM
                columnLabel,
                fullOCR.ocrConfidence
            );
            fullOCR.parsed.items = vlmDecisionResult.items;
            rebuildIssues(fullOCR.parsed);
            logger.info("[VLM_SAFETY] Decision Engine completed", {
                total: vlmDecisionResult.summary.total,
                high_confidence: vlmDecisionResult.summary.high_confidence,
                manual_required: vlmDecisionResult.summary.manual_required,
                alert_blocked: vlmDecisionResult.summary.alert_blocked,
            });
        } catch (err) {
            logger.warn("[VLM_SAFETY] Decision Engine failed — keeping VLM values with safety enrichment", { error: err.message });
            rebuildIssues(fullOCR.parsed);
        }
        pipelineTrace.step(trace, "DECISION_ENGINE_DONE", vlmDecisionResult ? "SUCCESS" : "SKIPPED", {
            input_summary: {
                store_code: storeInfo.storeCode,
                column_label: columnLabel,
                ocr_confidence: fullOCR.ocrConfidence,
            },
            output_summary: vlmDecisionResult ? vlmDecisionResult.summary : { reason: "VLM_DECISION_FALLBACK" },
        });

        // Skip legacy layers that don't apply to VLM path
        pipelineTrace.step(trace, "MEMORY_DONE", "SKIPPED", {
            output_summary: { reason: "VLM_SAFETY_PATH", memory_used: false },
        });
        pipelineTrace.step(trace, "WRITER_PROFILE_DONE", "SKIPPED", {
            output_summary: { reason: "VLM_SAFETY_PATH" },
        });
        pipelineTrace.step(trace, "VISION_REVIEW_DONE", "SKIPPED", {
            output_summary: { reason: "VLM_IS_THE_VISION" },
        });

        // ─── Step 4: Alert Composer ────────────────────────────────
        let vlmAlertPayload = null;
        try {
            vlmAlertPayload = alertComposer.composeAlertPayload({
                submissionId: "pending",
                storeCode: storeInfo.storeCode,
                storeName: storeInfo.storeName,
                items: fullOCR.parsed.items || [],
                selectedColumn: columnLabel,
                lang: session.language,
            });
            pipelineTrace.step(trace, "ALERT_COMPOSER_DONE", "SUCCESS", {
                output_summary: {
                    alert_would_send: !!vlmAlertPayload,
                    issue: vlmAlertPayload ? vlmAlertPayload.issue : null,
                },
            });
        } catch (err) {
            pipelineTrace.step(trace, "ALERT_COMPOSER_DONE", "SKIPPED", {
                output_summary: { reason: "ALERT_COMPOSER_ERROR", error: err.message },
            });
        }

        // ─── Step 5: Reply Builder ─────────────────────────────────
        const vlmReplyMsg = _buildVlmReply(fullOCR.parsed, storeInfo);
        pipelineTrace.step(trace, "REPLY_BUILDER_DONE", "SUCCESS", {
            output_summary: {
                builder: "_buildVlmReply",
                reply_chars: vlmReplyMsg.length,
            },
        });

        // ─── Step 6: Database Write ────────────────────────────────
        const vlmConfidence = (fullOCR.parsed.confidence || 0);
        fullOCR.parsed.status = "PENDING";
        const ocrJson = buildOcrJson(fullOCR.rawText, fullOCR.parsed, {
            ocr_method: "VISION_LLM",
            evidence_count: evidenceImages.length,
            trace_id: trace && trace.trace_id ? trace.trace_id : null,
        });

        const submissionId = db.insertSubmission({
            store_name: storeInfo.storeName,
            phone_number: phone,
            employee_name: null,
            message_id: getMessageId(formCandidate.message),
            trace_id: trace && trace.trace_id ? trace.trace_id : null,
           