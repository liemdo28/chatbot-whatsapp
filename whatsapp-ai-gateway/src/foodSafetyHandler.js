const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { performOCR, parseTemperatures, buildOcrJson, FORM_TEMPLATES } = require("./ocr");
const { t, normalizeLanguage } = require("./language");
const db = require("./database");
const logger = require("./logger");
const gsheet = require("./googleSheet");
const {
    STORE_CONFIG,
    getGroupScope,
    resolveStoreFromContext,
    validateStoreGroupMatch,
    logRouterDecision,
    detectStoreFromText,
    storeNameToConfig,
} = require("./formImageRouter");
const pipelineTrace = require("./pipelineTrace");
const storeKnowledge = require("./storeKnowledge");
const { decideFormValues } = require("./foodSafetyDecisionEngine");
const zeroRetakeReply = require("./zeroRetakeReplyBuilder");
const openaiVision = require("./vision/providers/openaiVision");

// Per-phone session state for conversation flow
const sessions = {};
let ocrProcessorForTests = null;
let paddleBridgeForTests = undefined;

function getSession(phoneNumber) {
    if (!sessions[phoneNumber]) {
        sessions[phoneNumber] = {
            language: "ES",
            pendingSubmission: null,
            pendingStoreConfirmation: null,
            waitingFor: null, // 'action', 'image', 'store_confirmation'
            lastImageHash: null,
        };
    }
    return sessions[phoneNumber];
}

function getMessageId(message) {
    return message && message.id && message.id._serialized
        ? message.id._serialized
        : String(message && message.id ? message.id : "");
}

function getChatName(message) {
    return message._chatName || (message._data && message._data.chatName) || "";
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function performImageOCR(imagePath) {
    if (ocrProcessorForTests) return ocrProcessorForTests(imagePath);
    return performOCR(imagePath);
}

function getPaddleBridge() {
    if (paddleBridgeForTests !== undefined) return paddleBridgeForTests;
    try {
        return require("../paddleocr_bridge");
    } catch (_) {
        return null;
    }
}

function normalizeColumn(column) {
    const value = String(column || "").toUpperCase();
    if (value.includes("10")) return "10:00";
    if (value.includes("4") || value.includes("16")) return "16:00";
    return null;
}

function displayColumn(column) {
    if (column === "10:00") return "10AM";
    if (column === "16:00") return "4PM";
    return column || "N/A";
}

function fieldsForStore(storeInfo) {
    const knowledge = storeInfo ? storeKnowledge.getStoreKnowledge(storeInfo.storeCode) : null;
    if (knowledge && Array.isArray(knowledge.fields)) return knowledge.fields;

    const template = Object.values(FORM_TEMPLATES).find((item) => {
        return item && item.template_id === (storeInfo && storeInfo.templateId);
    });
    return template ? template.items.map((item) => ({
        field_id: item.id,
        label: item.label,
        range: [item.safeRange.min, item.safeRange.max],
    })) : [];
}

function storeInfoForManual(session) {
    const storeCode = (session.pendingSubmission && session.pendingSubmission.storeCode) || session.storeCode || "B2";
    const configured = STORE_CONFIG[storeCode] || STORE_CONFIG.B2;
    return { ...configured, routingSource: "manual_entry" };
}

function parseManualValues(body) {
    const rawValues = String(body || "").replace(/^MANUAL\b/i, "");
    return (rawValues.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

function buildManualParsed(values, storeInfo) {
    const fields = fieldsForStore(storeInfo);
    const items = fields.map((field, index) => {
        const fieldId = field.field_id || field.id;
        const range = field.range
            ? { min: field.range[0], max: field.range[1] }
            : { min: field.safeRange.min, max: field.safeRange.max };
        const value = values[index];
        const status = statusForValue(value, range);
        return {
            index: index + 1,
            id: fieldId,
            field_id: fieldId,
            label: field.label || fieldId,
            item: field.label || fieldId,
            detectedValue: value,
            value,
            detectedValues: {},
            unit: "F",
            safeRange: range,
            range_min: range.min,
            range_max: range.max,
            confidence: 1,
            isSafe: status === "SAFE",
            status,
            _predictionSource: "MANUAL_ENTRY",
            _predictionConfidence: 1,
            _needsConfirmation: false,
            _decision: {
                final_suggested_value: value,
                prediction_source: "MANUAL_CONFIRMED",
                prediction_confidence: 1,
                needs_confirmation: false,
                status: "CONFIDENT",
                alert_allowed: status === "UNSAFE",
                alert_block_reason: null,
                field_id: fieldId,
                raw_ocr_value: null,
            },
        };
    });

    return {
        store_id: storeInfo.storeId,
        storeName: storeInfo.storeName,
        store_name: storeInfo.storeName,
        template_id: storeInfo.templateId,
        template: storeInfo.storeName,
        template_detection_source: "manual_entry",
        isForm: true,
        classification: "MANUAL_ENTRY",
        shift_columns_detected: [],
        selected_column: null,
        items,
        issues: issuesForItems(items),
        confidence: 100,
        status: "PENDING",
        needsReview: false,
    };
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function statusForValue(value, range) {
    if (value === null || value === undefined) return "MISSING";
    return value >= range.min && value <= range.max ? "SAFE" : "UNSAFE";
}

function issuesForItems(items) {
    const issues = [];
    for (const item of items || []) {
        if (item.status === "UNSAFE") {
            issues.push({
                type: "UNSAFE_TEMP",
                item: item.label,
                id: item.id,
                detected: `${item.detectedValue}${item.unit || "F"}`,
                range: `${item.safeRange.min}-${item.safeRange.max}${item.unit || "F"}`,
                index: item.index,
            });
        } else if (item.status === "MISSING") {
            issues.push({ type: "MISSING_FIELD", item: item.label, id: item.id, index: item.index });
        }
    }
    return issues;
}

function parsedFromGpt4o(visionResult, storeInfo) {
    const selectedColumn = normalizeColumn(visionResult.selected_column || visionResult.shift);
    const byId = new Map();
    for (const reading of visionResult.readings || []) {
        if (reading && reading.field_id) byId.set(String(reading.field_id).toUpperCase(), reading);
    }

    const items = fieldsForStore(storeInfo).map((field, index) => {
        const fieldId = field.field_id || field.id;
        const reading = byId.get(String(fieldId).toUpperCase()) || {};
        const fieldKnowledge = storeKnowledge.getFieldKnowledge(storeInfo.storeCode, fieldId);
        const range = fieldKnowledge
            ? { min: fieldKnowledge.range[0], max: fieldKnowledge.range[1] }
            : { min: field.range ? field.range[0] : -40, max: field.range ? field.range[1] : 450 };
        const value = toNumberOrNull(reading.value);
        const confidence = Number(reading.confidence || 0);
        const status = statusForValue(value, range);

        return {
            index: index + 1,
            id: fieldId,
            field_id: fieldId,
            label: field.label || (fieldKnowledge && fieldKnowledge.label) || fieldId,
            item: field.label || (fieldKnowledge && fieldKnowledge.label) || fieldId,
            detectedValue: value,
            value,
            detectedValues: selectedColumn ? { [selectedColumn]: value } : {},
            raw_text: reading.raw_text || "",
            unit: "F",
            safeRange: range,
            range_min: range.min,
            range_max: range.max,
            confidence,
            isSafe: status === "SAFE",
            status,
            _predictionSource: "GPT4O_VISION_PRIMARY",
            _predictionConfidence: confidence,
            _needsConfirmation: confidence < 0.85 || value === null,
            _visionUsed: true,
            _visionValue: value,
            _visionConfidence: confidence,
            _visionReason: reading.notes || "",
        };
    });

    return {
        store_id: storeInfo.storeCode,
        storeName: storeInfo.storeName,
        store_name: storeInfo.storeName,
        template_id: storeInfo.templateId,
        template: storeInfo.storeName,
        date: visionResult.date || null,
        selected_column: selectedColumn,
        isForm: visionResult.is_food_safety_form !== false && items.length > 0,
        classification: visionResult.is_food_safety_form === false ? "EVIDENCE_ONLY" : "FOOD_SAFETY_FORM",
        confidence: Number(visionResult.overall_confidence || 0),
        items,
        issues: issuesForItems(items),
        _visionResult: visionResult,
    };
}

function buildProofBlock(proof) {
    const lines = [
        "",
        "Runtime proof:",
        `trace_id: ${proof.traceId || "N/A"}`,
        `image_hash: ${proof.imageHash || "N/A"}`,
        `handler selected: ${proof.handlerSelected || "N/A"}`,
        `pipeline selected: ${proof.pipelineSelected || "N/A"}`,
        `Vision confidence provider: ${proof.ocrProvider || "none"}`,
        `vision_system: ${proof.visionSystem || "N/A"}`,
        `primary_provider: ${proof.primaryProvider || "N/A"}`,
        `fallback_provider: ${proof.fallbackProvider || "N/A"}`,
        `provider_used: ${proof.providerUsed || "N/A"}`,
        `fallback_used: ${proof.fallbackUsed ? "true" : "false"}`,
        `decision_engine_final: ${proof.decisionEngineFinal ? "true" : "false"}`,
        `store resolver result: ${proof.storeResolverResult || "N/A"}`,
        `selected column: ${proof.selectedColumn || "N/A"}`,
        `final reply id: ${proof.finalReplyId || "N/A"}`,
        `execution path count: ${proof.executionPathCount || 1}`,
        `WhatsApp reply count: ${proof.replyCount || 1}`,
    ];
    return lines.join("\n");
}

function appendProof(reply, proof) {
    return `${reply}${buildProofBlock(proof)}`;
}

async function saveMessageImage(message) {
    const media = message._cachedMedia || await message.downloadMedia();
    if (!media || !media.data) return null;

    const buffer = Buffer.from(media.data, "base64");
    const evidenceDir = path.join(__dirname, "..", "data", "evidence");
    ensureDir(evidenceDir);
    const filename = `evidence_${Date.now()}_${uuidv4().slice(0, 8)}.jpg`;
    const imagePath = path.join(evidenceDir, filename);
    fs.writeFileSync(imagePath, buffer);

    return {
        imagePath,
        buffer,
        hash: sha256(buffer),
        mediaId: media.mediaKey || (message._data && message._data.mediaKey) || "",
    };
}

async function processLegacyOcrPath(ctx) {
    const { message, session, image, trace, proof, chatName } = ctx;
    const ocrResult = await performImageOCR(image.imagePath);
    pipelineTrace.step(trace, "OCR_DONE", "OK", {
        output_summary: {
            provider: ocrProcessorForTests ? "test_ocr_processor" : "tesseract",
            confidence: ocrResult.confidence,
        },
    });

    const parsed = parseTemperatures(ocrResult.rawText, {
        context: { chatName, chatId: message.from },
    });
    parsed.confidence = ocrResult.confidence;

    const storeInfo = resolveStoreFromContext(chatName, ocrResult.rawText, message.from);
    proof.storeResolverResult = storeInfo
        ? `${storeInfo.storeCode} ${storeInfo.storeName} via ${storeInfo.routingSource || "ocr_context"}`
        : "unresolved";
    proof.selectedColumn = displayColumn(parsed.selected_column);

    pipelineTrace.step(trace, "FORM_CLASSIFIED", parsed.isForm ? "OK" : "SKIPPED", {
        output_summary: { is_food_safety_form: parsed.isForm === true },
    });
    pipelineTrace.step(trace, "STORE_RESOLVED", storeInfo ? "OK" : "FAIL", {
        output_summary: { store: proof.storeResolverResult },
    });

    if (!parsed.isForm) {
        logRouterDecision({
            message_id: getMessageId(message),
            chat_id: message.from,
            chat_name: chatName,
            image_hash: image.hash,
            dedupe_status: "new",
            is_enabled_group: true,
            is_food_safety_form: false,
            processing_path: "silent_non_form",
            reply_count: 0,
            final_status: "ignored",
        });
        return null;
    }

    const decision = decideFormValues(
        parsed.items || [],
        storeInfo ? storeInfo.storeCode : "B2",
        null,
        parsed.selected_column,
        (ocrResult.confidence || 0) / 100
    );
    parsed.items = decision.items;
    parsed.issues = issuesForItems(parsed.items);

    const replyResult = zeroRetakeReply.buildSmartConfirmationMessage({
        items: parsed.items,
        storeInfo: storeInfo || { storeName: parsed.storeName, storeCode: parsed.store_id, templateId: parsed.template_id },
        selectedColumn: parsed.selected_column,
        language: session.language,
        ocrConfidence: ocrResult.confidence,
        predictionResult: decision,
    });

    const ocrJson = buildOcrJson(ocrResult.rawText, parsed, {
        runtime_pipeline: "legacy_ocr_explicit",
        trace_id: trace.trace_id,
    });
    const submissionId = db.insertSubmission({
        store_name: (storeInfo && storeInfo.storeName) || parsed.storeName || "Unknown",
        phone_number: message.from,
        employee_name: null,
        message_id: getMessageId(message),
        trace_id: trace.trace_id,
        image_path: image.imagePath,
        ocr_raw_text: ocrResult.rawText,
        ocr_json: ocrJson,
        ocr_confidence: ocrResult.confidence,
        detected_items: JSON.stringify(parsed.items),
        status: "PENDING",
        language: session.language,
    });
    pipelineTrace.setSubmissionId(trace, submissionId);
    pipelineTrace.step(trace, "DB_WRITE_DONE", "OK", { output_summary: { submission_id: submissionId } });

    session.pendingSubmission = {
        id: submissionId,
        parsed,
        imagePath: image.imagePath,
        rawText: ocrResult.rawText,
        ocrJson,
        storeName: (storeInfo && storeInfo.storeName) || parsed.storeName || "Unknown",
        storeCode: storeInfo && storeInfo.storeCode,
    };
    session.waitingFor = "action";

    pipelineTrace.step(trace, "REPLY_BUILDER_DONE", "OK", {
        output_summary: { final_reply_id: proof.finalReplyId, reply_count: 1 },
    });
    db.logMessage(message.from, "in", "[image]", "image");
    const finalReply = appendProof(replyResult.message, proof);
    db.logMessage(message.from, "out", finalReply, "text");
    return finalReply;
}

/**
 * Attempt store resolution from vision result fields.
 * The vision model sees the header and may return a store name.
 */
function resolveStoreFromVisionResult(visionResult) {
    const visionStore = visionResult.store || visionResult.store_name || "";
    if (visionStore) {
        const config = storeNameToConfig(visionStore);
        if (config) return { ...config, routingSource: "vision_header" };
    }
    return null;
}

async function processGpt4oPath(ctx) {
    const { message, session, image, trace, proof, chatName } = ctx;

    // ── Store Resolution ──
    const scope = getGroupScope({ chatId: message.from, chatName });
    let storeInfo = resolveStoreFromContext(chatName, "", message.from);
    proof.storeResolverResult = storeInfo
        ? `${storeInfo.storeCode} ${storeInfo.storeName} via ${storeInfo.routingSource || "group_context"}`
        : "unresolved";

    pipelineTrace.step(trace, "STORE_RESOLVED", storeInfo ? "OK" : "FAIL", {
        output_summary: { store: proof.storeResolverResult },
    });

    pipelineTrace.step(trace, "QUALITY_GATE_DONE", "OK", {
        output_summary: { saved_image_path: image.imagePath },
    });
    pipelineTrace.step(trace, "OCR_DONE", "SKIPPED", {
        output_summary: { provider: "none", reason: "gpt4o_vision_primary" },
    });

    // ── Call Vision LLM (always — even if store unresolved) ──
    const tempStoreInfo = storeInfo || { ...STORE_CONFIG.B2, storeCode: "??", templateId: "unknown" };
    const visionResult = await openaiVision.extractForm({
        imagePath: image.imagePath,
        storeInfo: tempStoreInfo,
        traceId: trace.trace_id,
        imageHash: image.hash,
        chatName,
        fields: storeInfo ? fieldsForStore(storeInfo) : [],
    });

    proof.gpt4oCalled = visionResult.called === true;
    proof.visionProvider = `${visionResult.provider || "openai"}/${visionResult.model || process.env.OPENAI_VISION_MODEL || "gpt-4o"}`;

    pipelineTrace.step(trace, "GPT4O_VISION_CALLED", visionResult.available ? "OK" : "FAIL", {
        output_summary: {
            called: visionResult.called === true,
            provider: visionResult.provider || "openai",
            model: visionResult.model || process.env.OPENAI_VISION_MODEL || "gpt-4o",
            latency_ms: visionResult.latency_ms || null,
            openai_request_id: visionResult.openai_request_id || null,
            reason: visionResult.reason || null,
        },
    });

    if (!visionResult.available) {
        const reply = appendProof(
            `Food Safety runtime blocked this image because Vision did not complete: ${visionResult.reason || "unavailable"}. No OCR fallback was used and no values were saved.`,
            proof
        );
        pipelineTrace.step(trace, "REPLY_BUILDER_DONE", "OK", {
            output_summary: { final_reply_id: proof.finalReplyId, blocked_reason: "vision_unavailable" },
        });
        db.logMessage(message.from, "out", reply, "text");
        return reply;
    }

    // Post-vision store resolution
    if (!storeInfo) {
        const visionStore = resolveStoreFromVisionResult(visionResult);
        if (visionStore) {
            storeInfo = visionStore;
            proof.storeResolverResult = `${storeInfo.storeCode} ${storeInfo.storeName} via ${storeInfo.routingSource}`;
            pipelineTrace.step(trace, "STORE_RESOLVED", "OK", {
                output_summary: { store: proof.storeResolverResult },
            });
        }
    }

    // If STILL unresolved — ask for confirmation (NEVER discard)
    if (!storeInfo) {
        session.pendingStoreConfirmation = {
            visionResult,
            imagePath: image.imagePath,
            traceId: trace.trace_id,
            imageHash: image.hash,
            chatName,
            proof: { ...proof },
        };
        session.waitingFor = "store_confirmation";

        const isES = session.language !== "EN";
        const confirmationMsg = [
            isES ? "\u{1F3EA} Necesito confirmaci\u00F3n de tienda:" : "\u{1F3EA} Need store confirmation:",
            "",
            "1 = B1 / The Rim",
            "2 = B2 / Stone Oak",
            "3 = B3 / Bandera",
            "",
            isES ? "Responda 1, 2, o 3 para continuar." : "Reply 1, 2, or 3 to continue.",
            isES ? "No se guardar\u00E1 hasta que confirme la tienda." : "Values will not be saved until store is confirmed.",
        ].join("\n");

        pipelineTrace.step(trace, "STORE_CONFIRMATION_SENT", "OK", {
            output_summary: { reason: "store_unresolved_logtest" },
        });
        db.logMessage(message.from, "in", "[image]", "image");
        db.logMessage(message.from, "out", confirmationMsg, "text");
        return confirmationMsg;
    }

    // Store validated — check group match
    const validation = validateStoreGroupMatch(chatName, storeInfo, message.from);
    if (!validation.valid) {
        const reply = appendProof(validation.message, proof);
        pipelineTrace.step(trace, "FORM_CLASSIFIED", "FAIL", {
            output_summary: { reason: "store_group_mismatch", expected: validation.expected, actual: validation.actual },
        });
        pipelineTrace.step(trace, "REPLY_BUILDER_DONE", "OK", {
            output_summary: { final_reply_id: proof.finalReplyId, blocked_reason: "store_group_mismatch" },
        });
        db.logMessage(message.from, "out", reply, "text");
        return reply;
    }

    // Re-extract with correct store fields if needed
    let parsed;
    if (tempStoreInfo.storeCode !== storeInfo.storeCode) {
        const correctedVisionResult = await openaiVision.extractForm({
            imagePath: image.imagePath,
            storeInfo,
            traceId: trace.trace_id,
            imageHash: image.hash,
            chatName,
            fields: fieldsForStore(storeInfo),
        });
        parsed = parsedFromGpt4o(
            correctedVisionResult.available ? correctedVisionResult : visionResult,
            storeInfo
        );
    } else {
        parsed = parsedFromGpt4o(visionResult, storeInfo);
    }

    // Deterministic Column Selection
    const visionReadings = visionResult.readings || [];
    const tenAmHasValues = visionReadings.some((r) => r && r.value_10am !== undefined && r.value_10am !== null && String(r.value_10am).trim() !== "");
    const fourPmHasValues = visionReadings.some((r) => r && r.value_4pm !== undefined && r.value_4pm !== null && String(r.value_4pm).trim() !== "");

    if (tenAmHasValues && !fourPmHasValues) {
        parsed.selected_column = "10:00";
    } else if (!tenAmHasValues && fourPmHasValues) {
        parsed.selected_column = "16:00";
    } else if (tenAmHasValues && fourPmHasValues) {
        parsed.selected_column = "16:00";
    }

    proof.selectedColumn = displayColumn(parsed.selected_column);

    pipelineTrace.step(trace, "FORM_CLASSIFIED", parsed.isForm ? "OK" : "FAIL", {
        output_summary: { is_food_safety_form: parsed.isForm, readings: visionReadings.length },
    });

    if (!parsed.isForm) {
        logRouterDecision({
            message_id: getMessageId(message),
            chat_id: message.from,
            chat_name: chatName,
            image_hash: image.hash,
            dedupe_status: "new",
            is_enabled_group: true,
            is_food_safety_form: false,
            processing_path: "gpt4o_vision_primary",
            reply_count: 0,
            final_status: "ignored",
        });
        return null;
    }

    pipelineTrace.step(trace, "VISION_REVIEW_DONE", "OK", {
        output_summary: {
            provider: proof.visionProvider,
            readings: parsed.items.length,
            selected_column: proof.selectedColumn,
        },
    });

    const decision = decideFormValues(parsed.items, storeInfo.storeCode, null, parsed.selected_column, parsed.confidence || 0);
    parsed.items = decision.items;
    parsed.issues = issuesForItems(parsed.items);
    pipelineTrace.step(trace, "DECISION_ENGINE_DONE", "OK", { output_summary: decision.summary });

    const ocrJson = JSON.stringify({
        trace_id: trace.trace_id,
        image_hash: image.hash,
        runtime_pipeline: "gpt4o_vision_primary",
        ocr_provider: "none",
        vision_provider: proof.visionProvider,
        gpt4o_called: proof.gpt4oCalled,
        openai_request_id: visionResult.openai_request_id || null,
        vision_result: visionResult,
        parsed,
    });

    const submissionId = db.insertSubmission({
        store_name: storeInfo.storeName,
        phone_number: message.from,
        employee_name: null,
        message_id: getMessageId(message),
        trace_id: trace.trace_id,
        image_path: image.imagePath,
        ocr_raw_text: "",
        ocr_json: ocrJson,
        ocr_confidence: 0,
        detected_items: JSON.stringify(parsed.items),
        status: "PENDING",
        language: session.language,
    });
    pipelineTrace.setSubmissionId(trace, submissionId);
    pipelineTrace.step(trace, "DB_WRITE_DONE", "OK", { output_summary: { submission_id: submissionId } });
    pipelineTrace.step(trace, "SHEET_SYNC_DONE", "SKIPPED", { output_summary: { reason: "pending_confirmation" } });

    session.pendingSubmission = {
        id: submissionId,
        parsed,
        imagePath: image.imagePath,
        rawText: "",
        ocrJson,
        storeName: storeInfo.storeName,
        storeCode: storeInfo.storeCode,
        traceId: trace.trace_id,
    };
    session.waitingFor = "action";

    const replyResult = zeroRetakeReply.buildSmartConfirmationMessage({
        items: parsed.items,
        storeInfo,
        selectedColumn: parsed.selected_column,
        language: session.language,
        ocrConfidence: 0,
        predictionResult: decision,
    });
    pipelineTrace.step(trace, "REPLY_BUILDER_DONE", "OK", {
        output_summary: { final_reply_id: proof.finalReplyId, reply_count: 1 },
    });

    db.logMessage(message.from, "in", "[image]", "image");
    const finalReply = appendProof(replyResult.message, proof);
    db.logMessage(message.from, "out", finalReply, "text");
    return finalReply;
}

async function processSubmissionBatch(images) {
    const first = (images || []).find((entry) => entry && entry.message);
    if (!first) return null;

    const message = first.message;
    const phone = message.from;
    const session = getSession(phone);
    const chatName = getChatName(message);
    const messageId = getMessageId(message);

    let trace = null;
    try {
        const image = await saveMessageImage(message);
        if (!image) return t(session.language, "ocr_failed");

        const groupScope = getGroupScope({ chatId: message.from, chatName });
        trace = pipelineTrace.start({
            chatId: message.from,
            chatName,
            sender: message.author || message.from,
            imageId: image.hash,
        });
        message._pipelineTrace = trace;

        const finalReplyId = `${trace.trace_id}-reply-1`;
        message._finalReplyId = finalReplyId;

        const proof = {
            traceId: trace.trace_id,
            imageHash: image.hash,
            handlerSelected: "foodSafetyHandler.processSubmissionBatch",
            pipelineSelected: "python_vision_llm_pipeline",
            ocrProvider: "none/skipped",
            visionSystem: "python_vision_llm_pipeline",
            primaryProvider: "gemini-flash",
            fallbackProvider: "claude-vision",
            providerUsed: "gemini-flash",
            fallbackUsed: false,
            decisionEngineFinal: false,
            storeResolverResult: "unresolved",
            selectedColumn: "N/A",
            finalReplyId,
            executionPathCount: 1,
            replyCount: 1,
        };

        pipelineTrace.step(trace, "IMAGE_RECEIVED", "OK", {
            input_summary: { message_id: messageId, chat_id: message.from, chat_name: chatName },
            output_summary: { image_hash: image.hash, media_id: image.mediaId || null },
        });
        pipelineTrace.step(trace, "HANDLER_SELECTED", "OK", {
            output_summary: { handler: proof.handlerSelected },
        });
        pipelineTrace.step(trace, "ROUTER_STARTED", "OK", {
            output_summary: { group_scope_role: groupScope.role, enabled: groupScope.enabled },
        });
        pipelineTrace.step(trace, "GROUP_RESOLVED", groupScope.processingEnabled ? "OK" : "SKIPPED", {
            output_summary: groupScope,
        });

        const useVisionPipeline = String(process.env.USE_VISION_LLM_PIPELINE || "true").toLowerCase() === "true" && !ocrProcessorForTests;
        proof.pipelineSelected = useVisionPipeline ? "python_vision_llm_pipeline" : "legacy_ocr_explicit";
        proof.ocrProvider = useVisionPipeline ? "none/skipped" : (ocrProcessorForTests ? "test_ocr_processor" : "tesseract");

        pipelineTrace.step(trace, "PIPELINE_SELECTED", "OK", {
            output_summary: {
                pipeline: proof.pipelineSelected,
                ocr_provider: proof.ocrProvider,
                vision_system: proof.visionSystem,
                primary_provider: proof.primaryProvider,
                fallback_provider: proof.fallbackProvider,
            },
        });

        const ctx = { message, session, image, trace, proof, chatName };
        return useVisionPipeline ? await processGpt4oPath(ctx) : await processLegacyOcrPath(ctx);
    } catch (err) {
        logger.error("Error handling image", { phone, error: err.message });
        if (trace) {
            pipelineTrace.step(trace, "REPLY_BUILDER_DONE", "FAIL", { error: err.message });
        }
        return t(session.language, "ocr_failed");
    }
}

async function handleImageMessage(message, client) {
    return processSubmissionBatch([{ message, client }]);
}

async function handleTextMessage(message, client) {
    const phone = message.from;
    const body = (message.body || "").trim();
    const session = getSession(phone);
    const upperBody = body.toUpperCase().trim();

    db.logMessage(phone, "in", body, "text");

    // Mi rejection
    if (upperBody.startsWith("/MI") || upperBody === "MI") {
        const reply = t(session.language, "mi_disabled");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    // Team support commands
    if (upperBody === "/HELP" || upperBody === "/H") {
        const reply = t(session.language, "team_help");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    if (upperBody === "/STATUS") {
        const waStatus = require("./clientManager").getStatus().status;
        const sheetConfigured = !!(process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_PATH);
        const reply = t(session.language, "team_status", {
            status: waStatus,
            sheet: sheetConfigured ? "Configurado" : "Pendiente (modo seguro)",
        });
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    if (upperBody === "/TEMPLATE") {
        const reply = session.language === "EN"
            ? "Stone Oak Food Safety Form Template:\n\nSO-01: Walk-In Cooler (30-45F)\nSO-02: Walk-In Freezer (-10-0F)\nSO-03: Prep Cooler (30-45F)\nSO-04: Reach-In Cooler (30-45F)\nSO-05: Reach-In Freezer (-10-0F)\nSO-06: Hot Holding (135-200F)\nSO-07: Cooking Temp (165-200F)\nSO-08: Cooling Step 1 (0-70F)\nSO-09: Cooling Step 2 (0-41F)\nSO-10: Dishwasher Sanitizer (150-180F)"
            : "Plantilla de Food Safety - Stone Oak:\n\nSO-01: Walk-In Cooler (30-45F)\nSO-02: Walk-In Freezer (-10-0F)\nSO-03: Prep Cooler (30-45F)\nSO-04: Reach-In Cooler (30-45F)\nSO-05: Reach-In Freezer (-10-0F)\nSO-06: Hot Holding (135-200F)\nSO-07: Cooking Temp (165-200F)\nSO-08: Cooling Step 1 (0-70F)\nSO-09: Cooling Step 2 (0-41F)\nSO-10: Dishwasher Sanitizer (150-180F)";
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    if (upperBody === "/LOG") {
        const subs = db.getSubmissions({ limit: 5 });
        let reply = session.language === "EN" ? "Recent submissions:\n" : "Env\u00EDos recientes:\n";
        if (subs.length === 0) {
            reply += session.language === "EN" ? "No submissions yet." : "Sin env\u00EDos a\u00FAn.";
        } else {
            for (const s of subs) {
                reply += `#${s.id} - ${s.store_name} - ${s.status} - ${s.created_at}\n`;
            }
        }
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    if (upperBody.startsWith("/AGENT")) {
        const reply = session.language === "EN"
            ? "Agent mode is admin-only. Use the dashboard for admin functions."
            : "El modo agente es solo para admins. Use el panel de administraci\u00F3n.";
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    // Language switch
    const newLang = normalizeLanguage(body);
    if (newLang) {
        session.language = newLang;
        const reply = t(newLang, "language_switched");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    if (upperBody === "HELP" || upperBody === "AYUDA") {
        const reply = t(session.language, "help_text");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    // === Store Confirmation Flow (1/2/3 reply) ===
    if (session.waitingFor === "store_confirmation" && session.pendingStoreConfirmation) {
        const storeChoice = upperBody.trim();
        const storeMap = { "1": "B1", "2": "B2", "3": "B3" };
        const chosenCode = storeMap[storeChoice];

        if (chosenCode) {
            const storeInfo = { ...STORE_CONFIG[chosenCode], routingSource: "manual_confirmation" };
            const pending = session.pendingStoreConfirmation;
            session.pendingStoreConfirmation = null;
            session.waitingFor = null;

            // Continue processing with confirmed store
            const visionResult = pending.visionResult;
            const parsed = parsedFromGpt4o(visionResult, storeInfo);

            // Deterministic Column Selection
            const visionReadings = visionResult.readings || [];
            const tenAmHasValues = visionReadings.some((r) => r && r.value_10am !== undefined && r.value_10am !== null && String(r.value_10am).trim() !== "");
            const fourPmHasValues = visionReadings.some((r) => r && r.value_4pm !== undefined && r.value_4pm !== null && String(r.value_4pm).trim() !== "");

            if (tenAmHasValues && !fourPmHasValues) {
                parsed.selected_column = "10:00";
            } else if (!tenAmHasValues && fourPmHasValues) {
                parsed.selected_column = "16:00";
            } else if (tenAmHasValues && fourPmHasValues) {
                parsed.selected_column = "16:00";
            }

            const decision = decideFormValues(parsed.items, storeInfo.storeCode, null, parsed.selected_column, parsed.confidence || 0);
            parsed.items = decision.items;
            parsed.issues = issuesForItems(parsed.items);

            const ocrJson = JSON.stringify({
                trace_id: pending.traceId,
                image_hash: pending.imageHash,
                runtime_pipeline: "gpt4o_vision_primary",
                ocr_provider: "none",
                vision_provider: "openai/gpt-4o",
                gpt4o_called: true,
                vision_result: visionResult,
                parsed,
            });

            const submissionId = db.insertSubmission({
                store_name: storeInfo.storeName,
                phone_number: phone,
                employee_name: null,
                message_id: "",
                trace_id: pending.traceId,
                image_path: pending.imagePath,
                ocr_raw_text: "",
                ocr_json: ocrJson,
                ocr_confidence: 0,
                detected_items: JSON.stringify(parsed.items),
                status: "PENDING",
                language: session.language,
            });

            session.pendingSubmission = {
                id: submissionId,
                parsed,
                imagePath: pending.imagePath,
                rawText: "",
                ocrJson,
                storeName: storeInfo.storeName,
                storeCode: storeInfo.storeCode,
                traceId: pending.traceId,
            };
            session.waitingFor = "action";

            const replyResult = zeroRetakeReply.buildSmartConfirmationMessage({
                items: parsed.items,
                storeInfo,
                selectedColumn: parsed.selected_column,
                language: session.language,
                ocrConfidence: 0,
                predictionResult: decision,
            });

            db.logMessage(phone, "out", replyResult.message, "text");
            return replyResult.message;
        }

        // Invalid choice — re-prompt
        const isES = session.language !== "EN";
        const rePrompt = [
            isES ? "Por favor responda 1, 2, o 3:" : "Please reply 1, 2, or 3:",
            "1 = B1 / The Rim",
            "2 = B2 / Stone Oak",
            "3 = B3 / Bandera",
        ].join("\n");
        db.logMessage(phone, "out", rePrompt, "text");
        return rePrompt;
    }

    if (upperBody.startsWith("MANUAL")) {
        const storeInfo = storeInfoForManual(session);
        const fields = fieldsForStore(storeInfo);
        const values = parseManualValues(body);

        if (values.length !== fields.length) {
            const reply = session.language === "EN"
                ? `Use MANUAL with ${fields.length} values, for example:\nMANUAL\n${fields.map((_, i) => i + 1).join(",")}`
                : `Use MANUAL con ${fields.length} valores, por ejemplo:\nMANUAL\n${fields.map((_, i) => i + 1).join(",")}`;
            db.logMessage(phone, "out", reply, "text");
            return reply;
        }

        const parsed = buildManualParsed(values, storeInfo);
        const ocrJson = buildOcrJson(body, parsed, {
            runtime_pipeline: "manual_entry",
            ocr_provider: "none/manual",
            vision_provider: "none/manual",
            trace_id: null,
        });
        const submissionId = db.insertSubmission({
            store_name: storeInfo.storeName,
            phone_number: phone,
            employee_name: null,
            message_id: getMessageId(message),
            trace_id: null,
            image_path: null,
            ocr_raw_text: body,
            ocr_json: ocrJson,
            ocr_confidence: 100,
            detected_items: JSON.stringify(parsed.items),
            status: "PENDING",
            language: session.language,
        });

        session.pendingSubmission = {
            id: submissionId,
            parsed,
            imagePath: null,
            rawText: body,
            ocrJson,
            storeName: storeInfo.storeName,
            storeCode: storeInfo.storeCode,
            manualRequired: false,
        };
        session.waitingFor = "action";

        const replyResult = zeroRetakeReply.buildSmartConfirmationMessage({
            items: parsed.items,
            storeInfo,
            selectedColumn: parsed.selected_column,
            language: session.language,
            ocrConfidence: 100,
            predictionResult: {
                items: parsed.items,
                summary: { total: parsed.items.length, high_confidence: parsed.items.length, alert_blocked: 0, manual_required: 0 },
            },
        });
        db.logMessage(phone, "out", replyResult.message, "text");
        return replyResult.message;
    }

    // If no pending submission, check for commands that need context
    if (!session.pendingSubmission) {
        if (["CONFIRM", "RETAKE", "MANAGER", "CANCEL"].includes(upperBody)) {
            const reply = t(session.language, "no_pending");
            db.logMessage(phone, "out", reply, "text");
            return reply;
        }
        if (upperBody.startsWith("EDIT")) {
            const reply = t(session.language, "no_pending");
            db.logMessage(phone, "out", reply, "text");
            return reply;
        }
        return null;
    }

    const sub = session.pendingSubmission;

    // CONFIRM
    if (upperBody === "CONFIRM") {
        try {
            db.updateSubmissionStatus(sub.id, "CONFIRMED");
            const now = new Date().toISOString();
            const reply = t(session.language, "saved_success", { id: sub.id, store: sub.storeName, date: now });
            db.logMessage(phone, "out", reply, "text");
            gsheet.syncSubmission(sub.id, sub).catch((sheetErr) => {
                logger.warn("Google Sheet sync failed (non-blocking)", { error: sheetErr.message });
            });
            session.pendingSubmission = null;
            session.waitingFor = null;
            return reply;
        } catch (err) {
            logger.error("CONFIRM save failed", { phone, error: err.message });
            return t(session.language, "save_failed");
        }
    }

    // RETAKE
    if (upperBody === "RETAKE") {
        session.pendingSubmission = null;
        session.waitingFor = "image";
        const reply = t(session.language, "retake_prompt");
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    // MANAGER
    if (upperBody === "MANAGER") {
        try {
            db.updateSubmissionStatus(sub.id, "MANAGER_REVIEW");
            const reply = t(session.language, "manager_sent");
            db.logMessage(phone, "out", reply, "text");
            session.pendingSubmission = null;
            session.waitingFor = null;
            return reply;
        } catch (err) {
            logger.error("MANAGER action failed", { phone, error: err.message });
            return t(session.language, "save_failed");
        }
    }

    // CANCEL
    if (upperBody === "CANCEL") {
        try {
            db.updateSubmissionStatus(sub.id, "CANCELLED");
            const reply = t(session.language, "cancelled");
            db.logMessage(phone, "out", reply, "text");
            session.pendingSubmission = null;
            session.waitingFor = null;
            return reply;
        } catch (err) {
            logger.error("CANCEL failed", { phone, error: err.message });
            return t(session.language, "save_failed");
        }
    }

    // EDIT
    if (upperBody.startsWith("EDIT")) {
        const parts = body.substring(4).trim().split(/\s+/);
        if (parts.length < 2) {
            const reply = t(session.language, "edit_applied", { field: "N/A", old: "N/A", new: "N/A \u2014 formato incorrecto. Use: EDIT 3 38 o EDIT SO-03 38" });
            db.logMessage(phone, "out", reply, "text");
            return reply;
        }

        let indexOrId = parts[0];
        const newValue = parseFloat(parts[1]);
        if (isNaN(newValue)) {
            return t(session.language, "edit_applied", { field: "N/A", old: "N/A", new: "N/A \u2014 valor no v\u00E1lido" });
        }

        let itemIndex = -1;
        const numIndex = parseInt(indexOrId);
        if (!isNaN(numIndex) && numIndex >= 1 && numIndex <= sub.parsed.items.length) {
            itemIndex = numIndex - 1;
        } else {
            itemIndex = sub.parsed.items.findIndex((it) => it.id.toUpperCase() === indexOrId.toUpperCase());
        }

        if (itemIndex < 0) {
            return t(session.language, "edit_applied", { field: indexOrId, old: "N/A", new: "N/A \u2014 art\u00EDculo no encontrado" });
        }

        const item = sub.parsed.items[itemIndex];
        const oldValue = item.detectedValue;
        item.detectedValue = newValue;
        item.status = newValue >= item.safeRange.min && newValue <= item.safeRange.max ? "SAFE" : "UNSAFE";
        item.isSafe = item.status === "SAFE";

        db.insertEdit({
            submission_id: sub.id,
            edit_command: body,
            field_index: itemIndex + 1,
            old_value: oldValue !== null ? String(oldValue) : "null",
            new_value: String(newValue),
        });

        const reply = t(session.language, "edit_applied", {
            field: `${item.id} (${item.label})`,
            old: oldValue !== null ? `${oldValue}${item.unit}` : "N/A",
            new: `${newValue}${item.unit}`,
        });
        db.logMessage(phone, "out", reply, "text");
        return reply;
    }

    return null;
}

function setOcrProcessorForTests(processor) {
    ocrProcessorForTests = processor;
}

function setPaddleBridgeForTests(bridge) {
    paddleBridgeForTests = bridge;
}

function resetProcessingCachesForTests() {
    ocrProcessorForTests = null;
    paddleBridgeForTests = undefined;
}

module.exports = {
    handleImageMessage,
    handleTextMessage,
    processSubmissionBatch,
    setOcrProcessorForTests,
    setPaddleBridgeForTests,
    resetProcessingCachesForTests,
    getSession,
    sessions,
};
