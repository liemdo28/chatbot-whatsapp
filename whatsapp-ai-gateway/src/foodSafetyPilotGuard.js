const { getGroupScope } = require("./formImageRouter");
const { STORE_TIMEZONE, getBusinessDateChicago } = require("./submissionDueConfig");
const logger = require("./logger");

const PHOTO_WORKFLOW_RETIRED_REPLY = [
    "Food Safety photo processing is no longer used for this pilot.",
    "Please use the new workflow:",
    "1. Type /agent",
    "2. Enter the temperature readings as numbers",
    "3. Review the summary",
    "4. Reply 1 to confirm",
    "Example:",
    "40",
    "10",
    "40",
    "150",
    "32",
    "...",
    "Paper forms should still be completed and kept for records.",
].join("\n");

const SHORT_PHOTO_INSTRUCTION = "Photos are not used for this pilot. Please type /agent and enter the numbers.";

function getMessageChatName(message) {
    return message && (message._chatName || (message._data && message._data.chatName) || "");
}

function getFoodSafetyPilotScope(message) {
    return getGroupScope({
        chatId: message && message.from,
        chatName: getMessageChatName(message),
    });
}

function isFoodSafetyPilotGroup(scope) {
    return !!scope && scope.processingEnabled === true && (
        scope.role === "production_log" ||
        scope.role === "logtest"
    );
}

function isImageMessage(message) {
    return !!message && message.hasMedia === true && message.type === "image";
}

function shouldRetireFoodSafetyPhoto(message) {
    if (!isImageMessage(message)) return false;
    return isFoodSafetyPilotGroup(getFoodSafetyPilotScope(message));
}

/**
 * Per-user-per-shift throttle for photo instructions.
 *
 * Returns:
 *   - `null`      → silent ignore (preferred for Option C pilot)
 *   - `string`    → reply text (only first photo per user per shift)
 *
 * Dedup key: phone + business_date_Chicago + shift_Chicago
 *
 * This is in-memory only — the controlled pilot runs from a single
 * gateway instance, so per-process dedup is sufficient.
 */
const _photoInstructionSent = new Set();

function getCurrentShift() {
    const now = new Date();
    const chicagoStr = now.toLocaleTimeString("en-US", {
        timeZone: STORE_TIMEZONE,
        hour: "numeric",
        hour12: false,
    });
    const hour = parseInt(chicagoStr.split(":")[0], 10);
    return hour < 14 ? "10AM" : "4PM";
}

function getPhotoInstruction(phone) {
    if (!phone) return null;
    const businessDate = getBusinessDateChicago();
    const shift = getCurrentShift();
    const key = `${phone}|${businessDate}|${shift}`;
    if (_photoInstructionSent.has(key)) {
        return null; // silent — already sent in this shift
    }
    _photoInstructionSent.add(key);
    logger.info("[PHOTO_INSTRUCTION] Sent short photo instruction (first in shift)", {
        phone, businessDate, shift,
    });
    return SHORT_PHOTO_INSTRUCTION;
}

function resetPhotoInstructionThrottle() {
    _photoInstructionSent.clear();
}

module.exports = {
    PHOTO_WORKFLOW_RETIRED_REPLY,
    SHORT_PHOTO_INSTRUCTION,
    getFoodSafetyPilotScope,
    isFoodSafetyPilotGroup,
    isImageMessage,
    shouldRetireFoodSafetyPhoto,
    getPhotoInstruction,
    resetPhotoInstructionThrottle,
};
