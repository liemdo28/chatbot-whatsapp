#!/usr/bin/env node
/**
 * build-safety-handler.js — CTO DIRECTIVE: Vision Safety Reintegration
 *
 * Builds the production foodSafetyHandler.js WITH safety layers integrated.
 * Vision-first architecture preserved. Safety restored.
 *
 * Usage: node tools/build-safety-handler.js
 */
const fs = require("fs");
const path = require("path");
const TARGET = path.join(__dirname, "..", "src", "foodSafetyHandler.js");
const BACKUP = TARGET + ".pre-safety-backup";

if (fs.existsSync(TARGET)) fs.copyFileSync(TARGET, BACKUP);

// Build file incrementally to avoid content size limits
const parts = [];
function w(s) { parts.push(s); }

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: Imports and constants
// ═══════════════════════════════════════════════════════════════════
w(`const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const {
    performOCR, parseTemperatures, formatDetectedSummary,
    buildOcrJson, FORM_TEMPLATES, LOW_CONFIDENCE_THRESHOLD,
} = require("./ocr");
const { getStoreGroup } = require("./failureEscalationService");
const { t, normalizeLanguage } = require("./language");
const db = require("./database");
const logger = require("./logger");
const gsheet = require("./googleSheet");
const {
    getGroupScope, isFormLikely, resolveStoreFromContext,
    validateStoreGroupMatch, logRouterDecision,
} = require("./formImageRouter");
const { recordRuntimePredictionAudit } = require("./handwriting/conflictResolver");
const { evaluateImageQuality, checkMinimumImageSize } = require("./imageQualityGate");
const { decideFormValues, evaluateSubmissionAlerts } = require("./foodSafetyDecisionEngine");
const visionAiReviewer = require("./visionAiReviewer");
const alertComposer = require("./foodSafetyAlertComposer");
const storeKnowledge = require("./storeKnowledge");
const pipelineTrace = require("./pipelineTrace");
const writerProfile = require("./handwriting/writerProfile");
const crossFieldIntelligence = require("./crossFieldIntelligence");
const zeroRetakeReply = require("./zeroRetakeReplyBuilder");
const captureRate = require("./captureRateDashboard");
const acceptanceCriteria = require("./acceptanceCriteria");
const pilot = require("./pilot/livePilotMetrics");
const visionLlmBridge = require("../vision_llm_bridge");

const SUBMISSION_WINDOW_MS = Number(process.env.FOOD_SAFETY_SUBMISSION_WINDOW_MS || 60000);
const REMINDER_MS = Number(process.env.FOOD_SAFETY_CONFIRM_REMINDER_MS || 60000);
const AUTO_CONFIRM_MS = Number(process.env.FOOD_SAFETY_AUTO_CONFIRM_MS || 5 * 60000);
const PENDING_REMINDERS_ENABLED = String(process.env.FOOD_SAFETY_PENDING_REMINDERS_ENABLED || "false").toLowerCase() === "true";
const AUTO_CONFIRM_ENABLED = String(process.env.FOOD_SAFETY_AUTO_CONFIRM_ENABLED || "false").toLowerCase() === "true";

// VLM Blank Cell Guard: fields with confidence below this are treated as blank
const VLM_MIN_FIELD_CONFIDENCE = 0.30;

const sessions = {};
const imageBatches = {};
let ocrProcessorForTests = null;
let paddleBridgeForTests = undefined;
`);

console.log("Section 1 (imports): written");

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: Core helpers
// ═══════════════════════════════════════════════════════════════════
w(`
function getSession(phoneNumber) {
    if (!sessions[phoneNumber]) {
        sessions[phoneNumber] = {
            language: "ES", pendingSubmission: null, waitingFor: null,
            employeeName: null, employeePhone: null, storeCode: null,
            groupId: null, chatName: null, reminderTimer: null, autoConfirmTimer: null,
        };
    }
    return sessions[phoneNumber];
}
function getHandwriting() { try { return require("./handwriting"); } catch (_) { return null; } }
function getPaddleBridge() {
    if (paddleBridgeForTests !== undefined) return paddleBridgeForTests;
    try { return require("../paddleocr_bridge"); } catch (_) { return null; }
}
async function performImageOCR(imagePath) {
    if (ocrProcessorForTests) return ocrProcessorForTests(imagePath);
    return performOCR(imagePath);
}
async function isPaddleOCRAvailable() {
    const bridge = getPaddleBridge(); if (!bridge) return false;
    try { return await bridge.isServiceAvailable(); } catch (err) { logger.warn("PaddleOCR check failed", { error: err.message }); return false; }
}
function getMessageId(message) { return message && message.id && message.id._serialized ? message.id._serialized : String(message && message.id ? message.id : ""); }
function getChatName(message) { return message._chatName || (message._data && message._data.chatName) || ""; }
function imageHash(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

async function saveMessageImage(message) {
    let media = message._cachedMedia || null;
    if (!media) media = await message.downloadMedia();
    if (!media || !media.data) return null;
    const buffer = Buffer.from(media.data, "base64");
    const evidenceDir = path.join(__dirname, "..", "data", "evidence");
    ensureDir(evidenceDir);
    const filename = "evidence_" + Date.now() + "_" + uuidv4().slice(0, 8) + ".jpg";
    const imagePath = path.join(evidenceDir, filename);
    fs.writeFileSync(imagePath, buffer);
    return { imagePath, hash: message._imageHash || imageHash(buffer), mediaId: media.mediaKey || (message._data && message._data.mediaKey) || "" };
}
function getTemplateById(templateId) {
    return Object.values(FORM_TEMPLATES).find((t) => t && t.template_id === templateId) || null;
}
function templateItems(storeInfo) { const t = getTemplateById(storeInfo && storeInfo.templateId); return t ? t.items : []; }

function buildEmptyParsed(storeInfo, selectedColumn = null) {
    const items = templateItems(storeInfo).map((item, i) => ({
        index: i+1, id: item.id, field_id: item.id, label: item.label, item: item.label,
        detectedValue: null, value: null, detectedValues: {}, unit: item.unit || "F",
        safeRange: item.safeRange, range_min: item.safeRange.min, range_max: item.safeRange.max,
        confidence: 0, isSafe: false, status: "MISSING",
        _predictionSource: "HUMAN_REQUIRED", _needsConfirmation: true,
    }));
    return { store_id: storeInfo.storeId, storeName: storeInfo.storeName, store_name: storeInfo.storeName,
        template_id: storeInfo.templateId, template: storeInfo.storeName, isForm: true,
        classification: "FOOD_SAFETY_FORM", selected_column: selectedColumn, items,
        issues: items.map((it) => ({ type: "MISSING_FIELD", item: it.label, id: it.id, index: it.index })),
        confidence: 0, needsReview: true, tooManyMissingFields: true };
}
function normalizeColumn(c) { if (!c) return null; const t = String(c).toLowerCase(); if (t.includes("10")) return "10:00"; if (t.includes("4") || t.includes("16")) return "16:00"; return null; }
function displayColumn(c) { if (c === "10:00") return "10AM"; if (c === "16:00") return "4PM"; return c || "N/A"; }
`);
console.log("Section 2 (helpers): written");

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: VLM Safety Layer functions (NEW)
// ═══════════════════════════════════════════════════════════════════
w(`
// ═══════════════════════════════════════════════════════════════════════
// VLM SAFETY LAYER — Vision LLM -> Store Knowledge -> Decision Engine
// ═══════════════════════════════════════════════════════════════════════
function enrichVlmItemsWithStoreKnowledge(parsed, storeInfo) {
    for (const item of parsed.items || []) {
        const fieldId = item.field_id || item.id;
        const fk = storeKnowledge.getFieldKnowledge(storeInfo.storeCode, fieldId);
        if (fk) { item.safeRange = { min: fk.range[0], max: fk.range[1] }; item.range_min = fk.range[0]; item.range_max = fk.range[1]; item.label = item.label || fk.label; }
    }
    return parsed;
}
function vlmBlankCellGuard(parsed) {
    for (const item of parsed.items || []) {
        const v = item.detectedValue; if (v === null || v === undefined) continue;
        const notes = String(item._visionNotes || "").toLowerCase();
        const blank = /\\b(blank|empty|illegible|missing|not\\s*visible|no\\s*data|unclear)\\b/i.test(notes);
        const low = (item.confidence || 0) < VLM_MIN_FIELD_CONFIDENCE;
        if (blank || low) { item.detectedValue = null; item.value = null; item._needsConfirmation = true; item._predictionSource = "VLM_BLANK_GUARD"; }
    }
    return parsed;
}
function _buildVlmReply(parsed, storeInfo) {
    const lines = ["Food Safety form processed (Vision LLM)", "", "Store: " + storeInfo.storeName + " / " + storeInfo.storeCode, "Column: " + (parsed.selected_column ? displayColumn(parsed.selected_column) : "N/A"), ""];
    for (const item of parsed.items || []) {
        const val = item.detectedValue !== null && item.detectedValue !== undefined ? item.detectedValue + "\\u00B0F" : "missing";
        const fid = item.id || item.field_id || "?";
        const lbl = item.label || item.item || fid;
        lines.push("  \\u2022 " + fid + " " + lbl + ": " + val);
    }
    lines.push("", "Reply with: CONFIRM | EDIT <id> <value> | MANUAL | RETAKE | MANAGER | CANCEL");
    return lines.join("\\n");
}
`);
console.log("Section 3 (VLM safety functions): written");

// ═══════════════════════════════════════════════════════════════════
// SECTION 4: rebuildIssues, parsePaddleResult
// ═══════════════════════════════════════════════════════════════════
w(`
function rebuildIssues(parsed) {
    const issues = [];
    for (const item of parsed.items || []) {
        const v = item.detectedValue;
        if (v === null || v === undefined || Number.isNaN(Number(v))) {
            item.status = "MISSING"; item.isSafe = false;
            issues.push({ type: "MISSING_FIELD", item: item.label || item.item, id: item.id, index: item.index }); continue;
        }
        const min = item.safeRange ? item.safeRange.min : item.range_min;
        const max = item.safeRange ? item.safeRange.max : item.range_max;
        item.status = Number(v) >= min && Number(v) <= max ? "SAFE" : "UNSAFE";
        item.isSafe = item.status === "SAFE"; item.value = Number(v);
        if (!item.isSafe) { issues.push({ type: "UNSAFE_TEMP", item: item.label || item.item, id: item.id, detected: v + (item.unit||"F"), range: min + "-" + max + (item.unit||"F"), index: item.index }); }
    }
    parsed.issues = issues;
    parsed.tooManyMissingFields = issues.filter((i) => i.type === "MISSING_FIELD").length >= Math.ceil((parsed.items || []).length * 0.35);
    return parsed;
}
function parsePaddleResult(paddleResult, storeInfo) {
    const result = paddleResult.result || {};
    const selectedColumn = normalizeColumn(result.selected_column);
    const template = getTemplateById(storeInfo.templateId);
    const itemsById = new Map((template ? template.items : []).map((i) => [i.id, i]));
    const parsed = {
        store_id: storeInfo.storeId, storeName: storeInfo.storeName, store_name: storeInfo.storeName,
        template_id: result.template_id || storeInfo.templateId, template: storeInfo.storeName,
        template_detection_source: storeInfo.routingSource, isForm: true, classification: "FOOD_SAFETY_FORM",
        selected_column: selectedColumn,
        items: (result.items || []).map((it, i) => {
            const d = itemsById.get(it.id) || { label: it.item || it.id, safeRange: { min: it.range_min ?? -40, max: it.range_max ?? 450 }, unit: it.unit || "F" };
            return { index: i+1, id: it.id, field_id: it.id, label: it.item || d.label || it.id, item: it.item || d.label || it.id,
                detectedValue: it.value, value: it.value, detectedValues: { "10:00": it.column_10am_value, "16:00": it.column_4pm_value },
                unit: d.unit || it.unit || "F", safeRange: d.safeRange || { min: it.range_min, max: it.range_max },
                range_min: (d.safeRange && d.safeRange.min) ?? it.range_min, range_max: (d.safeRange && d.safeRange.max) ?? it.range_max,
                confidence: it.confidence || 0, status: it.status === "SAFE" ? "SAFE" : (it.status === "WARNING" ? "UNSAFE" : "MISSING"), isSafe: it.status === "SAFE" };
        }),
        confidence: paddleResult.meta && paddleResult