/**
 * Submission Due Config
 *
 * Defines the three enabled Food Safety log groups plus the management alert
 * group. Group IDs can be supplied through env without changing code:
 * FOOD_SAFETY_B1_GROUP_ID(S), FOOD_SAFETY_B2_GROUP_ID(S),
 * FOOD_SAFETY_B3_GROUP_ID(S), FOOD_SAFETY_MANAGEMENT_GROUP_ID(S).
 */

const { STORE_CONFIG } = require("./formImageRouter");

function parseEnvList(name) {
    const raw = process.env[name];
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch (_) {
        // Fall through to comma splitting.
    }
    return raw.split(",").map((v) => v.trim()).filter(Boolean);
}

function firstEnv(name, fallback) {
    const values = parseEnvList(name);
    return values.length > 0 ? values[0] : fallback;
}

function managerPhone(storeCode) {
    return process.env[`FOOD_SAFETY_${storeCode}_MANAGER_PHONE`] || STORE_CONFIG[storeCode].managerPhone;
}

function buildStoreGroup(storeCode) {
    const store = STORE_CONFIG[storeCode];
    return {
        store_id: store.storeId,
        store_code: store.storeCode,
        store_name: store.storeName,
        group_name: store.groupName,
        group_id: firstEnv(`FOOD_SAFETY_${storeCode}_GROUP_ID`, store.groupName),
        group_ids: parseEnvList(`FOOD_SAFETY_${storeCode}_GROUP_IDS`),
        manager_name: store.managerName,
        manager_phone: managerPhone(storeCode),
        manager_phones: [managerPhone(storeCode)],
        manager_display: store.managerDisplay,
        management_group_name: "Bakudan Management Team",
        management_group_id: firstEnv("FOOD_SAFETY_MANAGEMENT_GROUP_ID", "Bakudan Management Team"),
        management_group_ids: parseEnvList("FOOD_SAFETY_MANAGEMENT_GROUP_IDS"),
        expected_submissions: [
            { label: "AM Line Check", time: "10:00", grace_minutes: 30 },
            { label: "PM Line Check", time: "16:00", grace_minutes: 30 },
        ],
        alert_targets: {
            management_group: true,
            source_group: true,
            manager: false,
        },
        enabled: true,
    };
}

const DEFAULT_STORE_GROUPS = [
    buildStoreGroup("B1"),
    buildStoreGroup("B2"),
    buildStoreGroup("B3"),
];

let storeGroups = [...DEFAULT_STORE_GROUPS];

function loadConfig(configPath) {
    if (configPath && require("fs").existsSync(configPath)) {
        try {
            const raw = require("fs").readFileSync(configPath, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.store_groups)) {
                storeGroups = parsed.store_groups;
            }
        } catch (e) {
            console.error("[SubmissionDueConfig] Failed to load config:", e.message);
        }
    }
}

function getStoreGroups() {
    return storeGroups.filter((g) => g.enabled);
}

function getStoreGroup(storeIdOrCode) {
    return storeGroups.find((g) => {
        return g.enabled && (g.store_id === storeIdOrCode || g.store_code === storeIdOrCode);
    });
}

// San Antonio, Texas uses the America/Chicago timezone database entry.
const STORE_TIMEZONE = process.env.FOOD_SAFETY_TIMEZONE || "America/Chicago";

/**
 * Get the current date/time in America/Chicago timezone.
 */
function nowInChicago() {
    const now = new Date();
    const chicagoStr = now.toLocaleString("en-US", { timeZone: STORE_TIMEZONE });
    return new Date(chicagoStr);
}

/**
 * Get the business date in America/Chicago timezone (YYYY-MM-DD).
 */
function getBusinessDateChicago(date = new Date()) {
    return date.toLocaleDateString("en-CA", { timeZone: STORE_TIMEZONE }); // YYYY-MM-DD
}

/**
 * Get the current hour:minute in America/Chicago timezone.
 */
function getChicagoHourMinute(date = new Date()) {
    const parts = date.toLocaleTimeString("en-US", {
        timeZone: STORE_TIMEZONE,
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
    });
    const [h, m] = parts.split(":").map(Number);
    return { hour: h, minute: m };
}

/**
 * Build a deadline Date in America/Chicago timezone for a given date + HH:MM.
 * Returns a Date object whose UTC value represents that Chicago local time.
 */
function buildDeadlineInChicago(date, hours, minutes) {
    // Format the date parts in Chicago timezone
    const chicagoNow = date.toLocaleString("en-US", { timeZone: STORE_TIMEZONE });
    const chicagoDate = new Date(chicagoNow);
    chicagoDate.setHours(hours, minutes, 0, 0);
    return chicagoDate;
}

/**
 * Get expected submissions for a store, with deadlines calculated in America/Chicago timezone.
 * Each deadline is a Date object representing the Chicago-local time.
 */
function getExpectedSubmissions(storeId, date = new Date()) {
    const group = getStoreGroup(storeId);
    if (!group) return [];

    return group.expected_submissions.map((sub) => {
        const [hours, minutes] = sub.time.split(":").map(Number);
        const deadline = buildDeadlineInChicago(date, hours, minutes);
        return {
            label: sub.label,
            deadline,
            grace_minutes: sub.grace_minutes,
        };
    });
}

/**
 * Check whether a submission row represents a valid form submission.
 *
 * CEO DIRECTIVE — Food Safety Source Cleanup & Legacy Workflow Removal:
 *   Only CONFIRMED numeric text submissions (Option C) may cancel a
 *   reminder. SUPERSEDED_LEGACY, SUPERSEDED, CANCELLED, PENDING rows and
 *   any row from a legacy OCR/Vision pipeline are NEVER valid for the
 *   reminder-cancellation check.
 */
function isValidFormSubmission(submission) {
    if (!submission) return false;

    // CEO-LOCKED status allow-list — only confirmed numeric records pass.
    const validStatuses = ["CONFIRMED", "MANAGER_REVIEW", "SAVED", "AUTO_CONFIRMED"];
    if (!validStatuses.includes(submission.status)) return false;

    // Legacy rows are NEVER valid even if their status was somehow preserved.
    if (submission.status === "SUPERSEDED_LEGACY" || submission.status === "SUPERSEDED") return false;

    // ── Numeric Text Workflow (Option C) ──
    // These submissions have raw_values/mapped_values or runtime_pipeline = numeric_text_entry.
    // They are the ONLY acceptable kind for reminder cancellation.
    if (submission.raw_values || submission.mapped_values) {
        return true;
    }

    if (!submission.ocr_json) return false;
    try {
        const ocrData = JSON.parse(submission.ocr_json);

        // Numeric text submission embedded in ocr_json (rare; numeric usually writes raw_values)
        if (ocrData.runtime_pipeline === "numeric_text_entry") {
            return true;
        }

        // Hard reject ANY OCR/Vision pipeline — even if status slipped through.
        const legacyPipelines = [
            "python_vision_llm_pipeline",
            "gpt4o_vision_primary",
            "gpt4o_vision_fallback",
            "legacy_ocr_explicit",
            "manual_entry",
        ];
        if (legacyPipelines.includes(ocrData.runtime_pipeline)) return false;

        if (ocrData.is_form === false || ocrData.classification === "EVIDENCE_ONLY") return false;
        if (!ocrData.items || ocrData.items.length === 0) return false;
        if ((ocrData.confidence || 0) < 70 && submission.status !== "MANAGER_REVIEW") return false;
    } catch {
        return false;
    }
    return true;
}

module.exports = {
    loadConfig,
    getStoreGroups,
    getStoreGroup,
    getExpectedSubmissions,
    isValidFormSubmission,
    DEFAULT_STORE_GROUPS,
    STORE_TIMEZONE,
    nowInChicago,
    getBusinessDateChicago,
    getChicagoHourMinute,
    buildDeadlineInChicago,
};
