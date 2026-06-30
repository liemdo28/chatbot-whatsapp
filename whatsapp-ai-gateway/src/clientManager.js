const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const path = require("path");
const crypto = require("crypto");
const logger = require("./logger");
const db = require("./database");
const { handleImageMessage, handleTextMessage } = require("./foodSafetyHandler");
const numericRouter = require("./foodSafetyNumericRouter");
const { getGroupScope, logRouterDecision } = require("./formImageRouter");
const { isFoodSafetyPilotGroup, getFoodSafetyPilotScope } = require("./foodSafetyPilotGuard");
const pipelineTrace = require("./pipelineTrace");

require("dotenv").config();

const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const _processedImages = new Map();
const _processedMessageIds = new Map();
const _processedMediaIds = new Map();
const _processedChatTimestamps = new Map();
const _activeProcessing = new Set();

const STATUS = {
    DISCONNECTED: "DISCONNECTED",
    CONNECTING: "CONNECTING",
    QR_READY: "QR_READY",
    CONNECTED: "CONNECTED",
    RECONNECTING: "RECONNECTING",
    AUTH_REQUIRED: "AUTH_REQUIRED",
    FAILED: "FAILED",
};

let client = null;
let currentStatus = STATUS.DISCONNECTED;
let currentQR = null;
let lastError = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

function imageHash(buffer) {
    return crypto.createHash("md5").update(buffer).digest("hex");
}

function isDuplicateKey(map, key) {
    if (!key) return false;
    const now = Date.now();
    for (const [oldKey, ts] of map) {
        if (now - ts > DEDUP_WINDOW_MS) map.delete(oldKey);
    }
    if (map.has(key)) return true;
    map.set(key, now);
    return false;
}

function getStatus() {
    return {
        status: currentStatus,
        lastQR: currentQR ? true : false,
        lastError,
        reconnectAttempts,
        timestamp: new Date().toISOString(),
    };
}

function getQRData() {
    return currentQR;
}

async function resolveChatName(msg, isGroup) {
    if (!isGroup) return "";
    try {
        const chat = await msg.getChat();
        return chat && chat.name ? chat.name : "";
    } catch (_) {
        return "";
    }
}

function logDuplicate(msg, chatName, image_hash = "") {
    logRouterDecision({
        message_id: msg.id && msg.id._serialized ? msg.id._serialized : String(msg.id || ""),
        chat_id: msg.from || "",
        chat_name: chatName || "",
        image_hash,
        dedupe_status: "duplicate_ignored",
        is_enabled_group: true,
        is_food_safety_form: false,
        processing_path: "silent",
        reply_count: 0,
        final_status: "ignored",
    });
}

function whatsappMessageId(sentMessage) {
    return sentMessage && sentMessage.id && sentMessage.id._serialized
        ? sentMessage.id._serialized
        : String(sentMessage && sentMessage.id ? sentMessage.id : "");
}

async function sendWhatsAppReply(msg, reply, chatName) {
    if (!reply) return;
    const sent = await msg.reply(reply);
    const waReplyId = whatsappMessageId(sent);
    if (msg._pipelineTrace) {
        pipelineTrace.step(msg._pipelineTrace, "WHATSAPP_REPLY_SENT", "OK", {
            output_summary: {
                final_reply_id: msg._finalReplyId || null,
                whatsapp_reply_message_id: waReplyId || null,
                reply_count: 1,
            },
        });
    }
    logger.info("Reply sent", {
        to: msg.from,
        chatName,
        replyLength: reply.length,
        finalReplyId: msg._finalReplyId || null,
        whatsappReplyMessageId: waReplyId || null,
    });
}

async function unifiedHandler(msg) {
    const msgId = msg.id && msg.id._serialized ? msg.id._serialized : String(msg.id || "");
    try {
        const isGroup = msg.from && msg.from.includes("@g.us");
        const chatName = await resolveChatName(msg, isGroup);
        let groupScope = null;

        if (isGroup) {
            groupScope = getGroupScope({ chatId: msg.from, chatName });
            if (!groupScope.enabled) {
                logger.debug("Ignoring message from disabled group", { from: msg.from, chatName });
                return;
            }
            if (!groupScope.processingEnabled) {
                logger.debug("Ignoring inbound alerts-only group message", {
                    from: msg.from,
                    chatName,
                    role: groupScope.role,
                });
                return;
            }
        } else if (msg.hasMedia && msg.type === "image") {
            logger.debug("Ignoring direct-message image; Food Safety runs in enabled groups only", { from: msg.from });
            return;
        }

        msg._chatName = chatName || "";

        // ─── STEP 7: LOCKED DISPATCHER ─────────────────────────────────────────
        // CEO DIRECTIVE — Food Safety Source Cleanup & Legacy Workflow Removal
        //
        //   if isFoodSafetyGroup:
        //       route to FoodSafetyNumericRouter
        //       STOP
        //   else:
        //       route to AgentCoding / other bots
        //
        // No fallthrough. No second handler. No Agent-Coding reply.
        // ───────────────────────────────────────────────────────────────────────
        if (isFoodSafetyPilotGroup(groupScope)) {
            // Food Safety Numeric Router is the ONLY entry point for these groups.
            // It handles dedup internally via per-user-per-shift throttling and
            // numeric session state; we still keep a lightweight message-id dedup
            // here to short-circuit obvious replay storms.
            const chatTimestampKey = `fs-numeric:${msg.from || ""}:${msg.timestamp || ""}:${msg.type || ""}`;
            if (
                isDuplicateKey(_processedMessageIds, msgId) ||
                isDuplicateKey(_processedChatTimestamps, chatTimestampKey)
            ) {
                logger.info("[FS_NUMERIC_ROUTER] Duplicate message ignored", { msgId, from: msg.from, chatName });
                return;
            }

            logger.info("[FS_NUMERIC_ROUTER] Dispatching Food Safety message to numeric router", {
                from: msg.from || "",
                chatName,
                type: msg.type || "",
                hasMedia: !!msg.hasMedia,
                body: msg.body ? msg.body.substring(0, 80) : "",
            });

            const result = await numericRouter.handleFoodSafetyMessage(msg, client);
            const reply = typeof result === "string" ? result : (result && result.text);
            await sendWhatsAppReply(msg, reply, chatName);

            // ─── STOP: NO FALLTHROUGH TO OTHER HANDLERS ───
            return;
        }

        // ─── Non-Food-Safety path: only reached if the group is NOT a Food Safety group.
        // For the controlled pilot, every inbound group is a Food Safety group, so this
        // branch is effectively dead. It is kept for safety but should never run.
        logger.warn("[DISPATCHER] Non-Food-Safety group reached; no handler available", {
            from: msg.from, chatName, role: groupScope && groupScope.role,
        });
    } catch (err) {
        logger.error("Error in unified handler", { error: err.message, from: msg.from });
    } finally {
        _activeProcessing.delete(msgId);
    }
}

async function initializeClient() {
    if (client) {
        try {
            await client.destroy();
        } catch (_) {
            // ignore
        }
        client = null;
    }

    currentStatus = STATUS.CONNECTING;
    lastError = null;
    reconnectAttempts = 0;

    const sessionPath = process.env.SESSION_DATA_PATH || "./sessions";
    logger.info("Initializing WhatsApp client", { sessionPath });

    client = new Client({
        authStrategy: new LocalAuth({ dataPath: path.resolve(sessionPath) }),
        puppeteer: {
            headless: process.env.PUPPETEER_HEADLESS !== "false",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
            ],
            executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined,
        },
    });

    client.on("qr", async (qr) => {
        logger.info("QR code received");
        currentStatus = STATUS.QR_READY;
        try {
            const qrDataUrl = await qrcode.toDataURL(qr, { width: 400 });
            currentQR = { raw: qr, dataUrl: qrDataUrl };
        } catch (_) {
            currentQR = { raw: qr, dataUrl: null };
        }
        db.updateSessionStatus("gateway", STATUS.QR_READY);
    });

    client.on("ready", () => {
        logger.info("WhatsApp client is READY");
        currentStatus = STATUS.CONNECTED;
        currentQR = null;
        reconnectAttempts = 0;
        db.updateSessionStatus("gateway", STATUS.CONNECTED);
    });

    client.on("authenticated", () => {
        logger.info("WhatsApp authentication successful");
        currentStatus = STATUS.CONNECTING;
    });

    client.on("auth_failure", (msg) => {
        logger.error("WhatsApp authentication failed", { message: msg });
        currentStatus = STATUS.AUTH_REQUIRED;
        lastError = "Authentication failed: " + msg;
        db.updateSessionStatus("gateway", STATUS.AUTH_REQUIRED);
    });

    client.on("disconnected", async (reason) => {
        logger.warn("WhatsApp client disconnected", { reason });
        currentStatus = STATUS.DISCONNECTED;
        lastError = "Disconnected: " + reason;
        db.updateSessionStatus("gateway", STATUS.DISCONNECTED);
        if (reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++;
            currentStatus = STATUS.RECONNECTING;
            db.updateSessionStatus("gateway", STATUS.RECONNECTING);
            setTimeout(() => initializeClient(), 5000 * reconnectAttempts);
        }
    });

    // ─── Message Listeners ──────────────────────────────────────────────────────
    // FIXED: Previously the `message` handler had `if (!isGroup) await unifiedHandler(msg)`
    // which SILENTLY DROPPED all group messages including real inbound images.
    // Now BOTH group and non-group messages go through unifiedHandler, which has its
    // own group-scope checks internally.

    client.on("message", async (msg) => {
        logger.info("[RAW_MESSAGE] message event", {
            id: msg.id && msg.id._serialized ? msg.id._serialized : String(msg.id || ""),
            from: msg.from || "",
            type: msg.type || "",
            hasMedia: msg.hasMedia || false,
            fromMe: msg.fromMe || false,
            body: msg.body ? msg.body.substring(0, 80) : "",
            timestamp: msg.timestamp || "",
        });
        if (msg.fromMe) return;
        await unifiedHandler(msg);
    });

    client.on("message_create", async (msg) => {
        if (msg.fromMe) return;
        logger.info("[RAW_MESSAGE] message_create event", {
            id: msg.id && msg.id._serialized ? msg.id._serialized : String(msg.id || ""),
            from: msg.from || "",
            type: msg.type || "",
            hasMedia: msg.hasMedia || false,
            body: msg.body ? msg.body.substring(0, 80) : "",
        });
        await unifiedHandler(msg);
    });

    try {
        await client.initialize();
        logger.info("WhatsApp client initialization started");
    } catch (err) {
        logger.error("Failed to initialize WhatsApp client", { error: err.message });
        currentStatus = STATUS.FAILED;
        lastError = err.message;
        db.updateSessionStatus("gateway", STATUS.FAILED);
    }
}

async function resetSession() {
    logger.info("Resetting WhatsApp session");
    if (client) {
        try {
            await client.destroy();
        } catch (_) {
            // ignore
        }
        client = null;
    }
    currentStatus = STATUS.DISCONNECTED;
    currentQR = null;
    lastError = null;
    reconnectAttempts = 0;

    const fs = require("fs");
    const sessionPath = path.resolve(process.env.SESSION_DATA_PATH || "./sessions");
    try {
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            logger.info("Session data cleared", { path: sessionPath });
        }
    } catch (e) {
        logger.error("Failed to clear session data", { error: e.message });
    }

    db.updateSessionStatus("gateway", STATUS.DISCONNECTED);
    return { status: STATUS.DISCONNECTED };
}

async function reconnect() {
    logger.info("Manual reconnect triggered");
    return initializeClient();
}

async function sendMessage(phoneNumber, text) {
    if (!client || currentStatus !== STATUS.CONNECTED) {
        throw new Error("WhatsApp client not connected");
    }
    const chatId = String(phoneNumber).includes("@") ? String(phoneNumber) : `${phoneNumber}@c.us`;
    await client.sendMessage(chatId, text);
    db.logMessage(chatId, "out", text, "text");
}

function getClient() {
    return client;
}

function resetDedupForTests() {
    _processedImages.clear();
    _processedMessageIds.clear();
    _processedMediaIds.clear();
    _processedChatTimestamps.clear();
    _activeProcessing.clear();
}

module.exports = {
    STATUS,
    getStatus,
    getQRData,
    initializeClient,
    resetSession,
    reconnect,
    sendMessage,
    getClient,
    resetDedupForTests,
    _unifiedHandlerForTests: unifiedHandler,
};
