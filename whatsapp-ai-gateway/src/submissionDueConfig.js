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

function getExpectedSubmissions(storeId, date = new Date()) {
    const group = getStoreGroup(storeId);
    if (!group) return [];

    return group.expected_submissions.map((sub) => {
        const [hours, minutes] = sub.time.split(":").map(Number);
        const deadline = new Date(date);
        deadline.setHours(hours, minutes, 0, 0);
        return {
            label: sub.label,
            deadline,
            grace_minutes: sub.grace_minutes,
        };
    });
}

function isValidFormSubmission(submission) {
    if (!submission) return false;
    const validStatuses = ["CONFIRMED", "MANAGER_REVIEW", "SAVED", "AUTO_CONFIRMED"];
    if (!validStatuses.includes(submission.status)) return false;
    if (!submission.ocr_json) return false;
    try {
        const ocrData = JSON.parse(submission.ocr_json);
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
};
