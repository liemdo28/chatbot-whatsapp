// Part 1: Lines 1-500 of foodSafetyHandler.js
// Generates the first section: imports, helpers, buildEmptyParsed, normalizeColumn, displayColumn
const fs = require("fs");
const path = require("path");

const part1 = `const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const {
    performOCR,
    parseTemperatures,
    formatDetectedSummary,
    buildOcrJson,
    FORM_TEMPLATES,
    LOW_CONFIDENCE_THRESHOLD,
} = require("./ocr");
const { getStoreGroup } = require("./failureEscalationService");
const { t, normalizeLanguage } = require("./language");
const db = require("./database");
const logger = require("./logger");
const gsheet = require("./googleSheet");
const {
    getGroupScope,
    isFormLikely,
    resolveStoreFromContext,
    validateStoreGroupMatch,
    logRouterDecision,
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

function getSession(phoneNumber) {
    if (!sessions[phoneNumber]) {
        sessions[phoneNumber] = {
            language: "ES",
            pendingSubmission: null,
            waitingFor: null,
            employeeName: null,
            employeePhone: null,
            storeCode: null,
            groupId: null,
            chatName: null,
            reminderTimer: null,
            autoConfirmTimer: null,
        };
    }
    return sessions[phoneNumber];
}

function getHandwriting() {
    try { return require("./handwriting"); } catch (_) { return null; }
}

function getPaddleBridge() {
    if (paddleBridgeForTests !== undefined) return paddleBridgeForTests;
    try { return require("../paddleocr_bridge"); } catch (_) { return null; }
}

async function performImageOCR(imagePath) {
    if (ocrProcessorForTests) return ocrProcessorForTests(imagePath);
    return performOCR(imagePath);
}

async function isPaddleOCRAvailable() {
    const bridge = getPaddleBridge();
    if (!bridge) return false;
    try { return await bridge.isServiceAvailable(); } catch (err) {
        logger.warn("PaddleOCR availability check failed", { error: err.message });
        return false;
    }
}

function getMessageId(message) {
    return message && message.id && message.id._serialized ? message.id._serialized : String(message && message.id ? message.id : "");
}

function getChatName(message) {
    return message._chatName || (message._data && message._data.chatName) || "";
}

function imageHash(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function saveMessageImage(message) {
    let media = message._cachedMedia || null;
    if (!media) media = await message.downloadMedia();
    if (!media || !media.data) return null;
    const buffer = Buffer.from(media.data, "base64");
    const evidenceDir = path.join(__dirname, "..", "data", "evidence");
    ensureDir(evidenceDir);
    const filename = \`evidence_\${Date.now()}_\${uuidv4().slice(0, 8)}.jpg\`;
    const imagePath = path.join(evidenceDir, filename);
    fs.writeFileSync(imagePath, buffer);
    return {
        imagePath,
        hash: message._imageHash || imageHash(buffer),
        mediaId: media.mediaKey || (message._data && message._data.mediaKey) || "",
    };
}

function getTemplateById(templateId) {
    return Object.values(FORM_TEMPLATES).find((template) => template && template.template_id === templateId) || null;
}

function templateItems(storeInfo) {
    const template = getTemplateById(storeInfo && storeInfo.templateId);
    return template ? template.items : [];
}

function buildEmptyParsed(storeInfo, selectedColumn = null) {
    const items = templateItems(storeInfo).map((item, index) => ({
        index: index + 1, id: item.id, field_id: item.id, label: item.label,
        item: item.label, detectedValue: null, value: null, detectedValues: {},
        unit: item.unit || "F", safeRange: item.safeRange,
        range_min: item.safeRange.min, range_max: item.safeRange.max,
        confidence: 0, isSafe: false, status: "MISSING",
        _predictionSource: "HUMAN_REQUIRED", _needsConfirmation: true,
    }));
    return {
        store_id: storeInfo.storeId, storeName: storeInfo.storeName,
        store_name: storeInfo.storeName, template_id: storeInfo.templateId,
        template: storeInfo.storeName, isForm: true,
        classification: "FOOD_SAFETY_FORM", selected_column: selectedColumn,
        items,
        issues: items.map((item) => ({ type: "MISSING_FIELD", item: item.label, id: item.id, index: item.index })),
        confidence: 0, needsReview: true, tooManyMissingFields: true,
    };
}

function normalizeColumn(column) {
    if (!column) return null;
    const text = String(column).toLowerCase();
    if (text.includes("10")) return "10:00";
    if (text.includes("4") || text.includes("16")) return "16:00";
    return null;
}

function displayColumn(column) {
    if (column === "10:00") return "10AM";
    if (column === "16:00") return "4PM";
    return column || "N/A";
}

`;
fs.writeFileSync(path.join(__dirname, "part1.txt"), part1, "utf8");
console.log("Part 1 written:", part1.length, "chars");
