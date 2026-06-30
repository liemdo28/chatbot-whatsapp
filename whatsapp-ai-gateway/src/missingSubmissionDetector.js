/**
 * Missing Submission Detector — CEO LOCKDOWN
 *
 * Hard rules:
 *  - Store timezone = America/Chicago
 *  - 10:00 AM check → reminder only sent 10:30 AM – 11:00 AM CT if missing
 *  - 4:00 PM check → reminder only sent 4:30 PM – 5:00 PM CT if missing
 *  - Never send 10AM reminder at 4PM window and vice versa
 *  - Deduplication key: store_code + business_date_America_Chicago + shift
 *  - Confirmed submission cancels the corresponding reminder
 *  - No Vietnam-time reminders
 */

const db = require("./database");
const {
    getStoreGroups,
    getExpectedSubmissions,
    isValidFormSubmission,
    STORE_TIMEZONE,
    nowInChicago,
    getBusinessDateChicago,
    getChicagoHourMinute,
} = require("./submissionDueConfig");
const logger = require("./logger");

// CEO-LOCKED WINDOWS (in America/Chicago)
// 10:00 AM check → reminder 10:30 AM – 11:00 AM
// 4:00 PM check → reminder 4:30 PM – 5:00 PM
const SHIFT_WINDOWS = [
    {
        shift: "10AM",
        deadlineHour: 10,
        deadlineMinute: 0,
        windowStart: { hour: 10, minute: 0 },
        windowEnd: { hour: 10, minute: 59 },
        expectedSubmissionTimeLabel: "10:00 AM",
    },
    {
        shift: "4PM",
        deadlineHour: 16,
        deadlineMinute: 0,
        windowStart: { hour: 16, minute: 0 },
        windowEnd: { hour: 16, minute: 59 },
        expectedSubmissionTimeLabel: "4:00 PM",
    },
];

function isWithinMinutes(hourMinute, start, end) {
    const currentMinutes = hourMinute.hour * 60 + hourMinute.minute;
    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

function getActiveShiftWindow(hourMinute) {
    for (const w of SHIFT_WINDOWS) {
        if (isWithinMinutes(hourMinute, w.windowStart, w.windowEnd)) {
            return w;
        }
    }
    return null;
}

/**
 * Build reminder text per CEO directive format
 */
function buildReminderText(storeGroup, window, businessDate, lang = "ES") {
    const storeName = storeGroup.store_name;
    if (String(lang).toUpperCase() !== "EN") {
        return [
            "Falta el registro de Food Safety.",
            "",
            `Tienda: ${storeName} / ${storeGroup.store_code}`,
            `Hora esperada: ${window.expectedSubmissionTimeLabel}`,
            "Estado: No se recibio el registro numerico de temperaturas.",
            "",
            "Por favor escribe /agent y envia las 19 temperaturas.",
            "El formato en papel todavia debe completarse y guardarse.",
        ].join("\n");
    }
    return [
        `⚠️ Food Safety submission is missing.`,
        ``,
        `Store: ${storeName} / ${storeGroup.store_code}`,
        `Expected submission: ${window.expectedSubmissionTimeLabel}`,
        `Status: No numeric temperature submission received.`,
        ``,
        `Please type /agent and enter the 19 temperature readings.`,
        `Paper forms should still be completed and kept for records.`,
    ].join("\n");
}

/**
 * Build alert message for a missing submission (backward-compatible)
 */
function buildAlertMessage(storeGroup, expected, now) {
    const storeName = storeGroup.store_name;
    const deadline = expected.deadline;
    const timeStr = deadline.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });

    const messageLinesEs = [
        "Falta el registro de Food Safety.",
        "",
        `Tienda: ${storeName} / ${storeGroup.store_code}`,
        `Hora esperada: ${timeStr}`,
        "Estado: No se recibio el registro numerico de temperaturas.",
        "",
        "Por favor escribe /agent y envia las 19 temperaturas.",
        "El formato en papel todavia debe completarse y guardarse.",
    ];
    const messageLines = [
        `⚠️ Food Safety submission is missing.`,
        ``,
        `Store: ${storeName} / ${storeGroup.store_code}`,
        `Expected submission: ${timeStr}`,
        `Status: No numeric temperature submission received.`,
        ``,
        `Please type /agent and enter the 19 temperature readings.`,
        `Paper forms should still be completed and kept for records.`,
    ];

    return {
        es: messageLinesEs.join("\n"),
        en: messageLines.join("\n"),
        store_id: storeGroup.store_id,
        store_code: storeGroup.store_code,
        store_name: storeName,
        issue: "missing_submission",
        action_needed: "Type /agent and enter temperature readings.",
        label: expected.label,
        deadline: deadline.toISOString(),
        detected_at: now.toISOString(),
    };
}

function parseSubmissionOcrJson(submission) {
    if (!submission || !submission.ocr_json) return null;
    try {
        return JSON.parse(submission.ocr_json);
    } catch (_) {
        return null;
    }
}

function parseSubmissionCreatedAt(createdAt) {
    if (!createdAt) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(createdAt)) {
        return new Date(createdAt.replace(" ", "T") + "Z");
    }
    const parsed = new Date(createdAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function submissionMatchesGroup(submission, group) {
    if (!submission || !group) return false;

    if (String(submission.store_name || "").trim().toLowerCase() === String(group.store_name || "").trim().toLowerCase()) {
        return true;
    }

    const ocrData = parseSubmissionOcrJson(submission);
    if (!ocrData) return false;

    return String(ocrData.store_code || "").trim().toUpperCase() === String(group.store_code || "").trim().toUpperCase()
        || String(ocrData.store_name || "").trim().toLowerCase() === String(group.store_name || "").trim().toLowerCase();
}

/**
 * Find submissions that fall within a given shift window on a business date
 */
function findSubmissionsForShift(group, businessDate, shift) {
    const window = SHIFT_WINDOWS.find(w => w.shift === shift);
    if (!window) return [];

    const allSubmissions = db.getSubmissions({ limit: 5000 });

    return allSubmissions.filter(sub => {
        if (!submissionMatchesGroup(sub, group)) {
            return false;
        }

        const ocrData = parseSubmissionOcrJson(sub);
        if (ocrData && ocrData.business_date && ocrData.business_date !== businessDate) {
            return false;
        }

        // ── Priority 1: explicit business_date + shift from the numeric workflow ──
        if (ocrData && ocrData.shift) {
            if (ocrData.business_date) {
                return ocrData.business_date === businessDate && ocrData.shift === shift;
            }
            return ocrData.shift === shift;
        }

        // ── Priority 2: fallback to submission timestamp in Chicago local time ──
        const subDate = parseSubmissionCreatedAt(sub.created_at);
        if (!subDate) return false;
        if (getBusinessDateChicago(subDate) !== businessDate) {
            return false;
        }
        const hm = getChicagoHourMinute(subDate);
        const minutes = hm.hour * 60 + hm.minute;
        const deadlineMinutes = window.deadlineHour * 60 + window.deadlineMinute;
        return Math.abs(minutes - deadlineMinutes) <= 120;
    });
}

/**
 * Check if a confirmed submission exists for a shift
 */
function hasConfirmedSubmissionForShift(group, businessDate, shift) {
    const submissions = findSubmissionsForShift(group, businessDate, shift);
    return submissions.some(s => isValidFormSubmission(s));
}

/**
 * Main check function - returns missing submission alerts
 * Implements CEO-LOCKED TIMEZONE WINDOWS
 */
function detectMissingSubmissions(date = new Date()) {
    const groups = getStoreGroups();
    const nowChic = getChicagoHourMinute(date);
    const businessDate = getBusinessDateChicago(date);

    const missing = [];

    // CEO-LOCKED: Only check missing submissions during the active reminder window
    const activeWindow = getActiveShiftWindow(nowChic);

    if (!activeWindow) {
        logger.info("[MissingSubmissionDetector] No active reminder window", {
            chicago_time: `${nowChic.hour}:${String(nowChic.minute).padStart(2, '0')}`,
            business_date: businessDate,
            timezone: STORE_TIMEZONE,
        });
        return [];
    }

    logger.info("[MissingSubmissionDetector] Active reminder window", {
        shift: activeWindow.shift,
        chicago_time: `${nowChic.hour}:${String(nowChic.minute).padStart(2, '0')}`,
        business_date: businessDate,
        timezone: STORE_TIMEZONE,
    });

    for (const group of groups) {
        // CEO Rule 3 + 5: Only check this shift, only if not already confirmed
        const hasConfirmed = hasConfirmedSubmissionForShift(group, businessDate, activeWindow.shift);

        if (hasConfirmed) {
            logger.info("[MissingSubmissionDetector] Submission confirmed, skipping reminder", {
                store_code: group.store_code,
                shift: activeWindow.shift,
                business_date: businessDate,
            });
            continue;
        }

        // Generate dedup key: store_code + business_date + shift
        const dedupKey = `${group.store_code}|${businessDate}|${activeWindow.shift}`;

        // Check if reminder was already sent today for this shift
        if (db.wasReminderSentToday && db.wasReminderSentToday(dedupKey)) {
            logger.info("[MissingSubmissionDetector] Reminder already sent (dedup)", {
                dedup_key: dedupKey,
            });
            continue;
        }

        const alert = {
            store_id: group.store_id,
            store_code: group.store_code,
            store_name: group.store_name,
            group_id: group.group_id,
            group_ids: group.group_ids,
            shift: activeWindow.shift,
            business_date: businessDate,
            expected_submission_time: activeWindow.expectedSubmissionTimeLabel,
            deadline_chicago: `${String(activeWindow.deadlineHour).padStart(2, '0')}:${String(activeWindow.deadlineMinute).padStart(2, '0')}`,
            issue: `missing_${activeWindow.shift.toLowerCase()}_submission`,
            action_needed: `Type /agent and enter temperature readings. Expected at ${activeWindow.expectedSubmissionTimeLabel}.`,
            text: buildReminderText(group, activeWindow, businessDate, "ES"),
            es: buildReminderText(group, activeWindow, businessDate, "ES"),
            en: buildReminderText(group, activeWindow, businessDate, "EN"),
            label: `${group.store_code} ${activeWindow.shift} missing submission`,
            detected_at: date.toISOString(),
            detected_chicago_time: `${nowChic.hour}:${String(nowChic.minute).padStart(2, '0')}`,
            dedup_key: dedupKey,
            timezone: STORE_TIMEZONE,
        };

        missing.push(alert);
    }

    logger.info("[MissingSubmissionDetector] Check complete", {
        groups_checked: groups.length,
        missing_count: missing.length,
        active_shift: activeWindow.shift,
        chicago_time: `${nowChic.hour}:${String(nowChic.minute).padStart(2, '0')}`,
        business_date: businessDate,
        timezone: STORE_TIMEZONE,
    });

    return missing;
}

/**
 * Get dashboard data for missing submissions panel
 */
function getSubmissionStatus(date = new Date()) {
    const groups = getStoreGroups();
    const businessDate = getBusinessDateChicago(date);
    const nowChic = getChicagoHourMinute(date);

    const results = [];

    for (const group of groups) {
        const windowStatuses = SHIFT_WINDOWS.map(window => {
            const submissions = findSubmissionsForShift(group, businessDate, window.shift);
            const hasValid = submissions.some(s => isValidFormSubmission(s));

            const inReminderWindow = isWithinMinutes(nowChic, window.windowStart, window.windowEnd);

            return {
                shift: window.shift,
                expected_time: window.expectedSubmissionTimeLabel,
                window_start: `${window.windowStart.hour}:${String(window.windowStart.minute).padStart(2, '0')}`,
                window_end: `${window.windowEnd.hour}:${String(window.windowEnd.minute).padStart(2, '0')}`,
                in_reminder_window: inReminderWindow,
                has_confirmed_submission: hasValid,
                submission_count: submissions.length,
                reminder_needed: inReminderWindow && !hasValid,
                business_date: businessDate,
            };
        });

        results.push({
            store_id: group.store_id,
            store_code: group.store_code,
            store_name: group.store_name,
            shifts: windowStatuses,
            business_date: businessDate,
            chicago_time: `${nowChic.hour}:${String(nowChic.minute).padStart(2, '0')}`,
            timezone: STORE_TIMEZONE,
        });
    }

    return results;
}

module.exports = {
    detectMissingSubmissions,
    getSubmissionStatus,
    buildAlertMessage,
    buildReminderText,
    isValidFormSubmission,
    hasConfirmedSubmissionForShift,
    findSubmissionsForShift,
    getActiveShiftWindow,
    SHIFT_WINDOWS,
    STORE_TIMEZONE,
    getBusinessDateChicago,
    getChicagoHourMinute,
};
