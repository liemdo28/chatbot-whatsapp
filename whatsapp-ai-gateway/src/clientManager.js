const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const path = require("path");
const crypto = require("crypto");
const logger = require("./logger");
const db = require("./database");
const { handleImageMessage, handleTextMessage } = require("./foodSafetyHandler");
const { getGroupScope, logRouterDecision } = require("./formImageRouter");
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

async function unifiedHandler(msg) {
    const msgId = msg.id && msg.id._serialized ? msg.id._serialized : String(msg.id || "");
    try {
        const isGroup = msg.from && msg.from.includes("@g.us");
        const chatName = await resolveChatName(msg, isGroup);

        if (isGroup) {
            const groupScope = getGroupScope({ chatId: msg.from, chatName });
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

        if (msg.hasMedia && msg.type === "image") {
            const chatTimestampKey = `${msg.from || ""}:${msg.timestamp || ""}`;
            if (
                isDuplicateKey(_processedMessageIds, msgId) ||
                isDuplicateKey(_processedChatTimestamps, chatTimestampKey)
            ) {
                logDuplicate(msg, chatName);
                return;
            }

            if (_activeProcessing.has(msgId)) {
                logDuplicate(msg, chatName);
                return;
            }
            _activeProcessing.add(msgId);

            try {
                const media = await msg.downloadMedia();
                if (media) {
                    const mediaId = media.mediaKey || (msg._data && msg._data.mediaKey) || "";
                    if (mediaId && isDuplicateKey(_processedMediaIds, `${msg.from}:${mediaId}`)) {
                        logDuplicate(msg, chatName);
                        return;
                    }
                    const hash = imageHash(Buffer.from(media.data, "base64"));
                    if (isDuplicateKey(_processedImages, `${msg.from}:${hash}`)) {
                        logger.info("Duplicate image ignored", { msgId, hash });
                        logDuplicate(msg, chatName, hash);
                        return;
                    }
                    msg._cachedMedia = media;
                    msg._imageHash = hash;
                }
            } catch (err) {
                logger.warn("Dedup media download failed; passing to handler", { error: err.message });
            }
        }

        msg._chatName = chatName || "";

        if (msg.hasMedia && msg.type === "image") {
            const result = await handleImageMessage(msg, client);
            const reply = typeof result === "string" ? result : (result && result.text);
            if (reply) {
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
        } else if (msg.body && msg.body.trim()) {
            const reply = await handleTextMessage(msg, client);
            if (reply) await msg.reply(reply);
        }
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
