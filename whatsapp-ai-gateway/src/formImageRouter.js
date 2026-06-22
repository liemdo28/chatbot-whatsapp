/**
 * Unified Food Safety image router.
 *
 * This module is intentionally the single source of truth for:
 * - WhatsApp group scope
 * - store/template routing
 * - strict form detection
 * - manager mapping
 */

const logger = require("./logger");

const STORE_CONFIG = {
    B1: {
        storeCode: "B1",
        storeId: "rim",
        storeName: "The Rim",
        templateId: "FoodSafety-Rim-v3",
        fieldPrefix: "RIM",
        groupName: "B1 Kitchen Log",
        managerName: "David",
        managerPhone: "12106853184",
        managerDisplay: "+1 (210) 685-3184",
    },
    B2: {
        storeCode: "B2",
        storeId: "stone_oak",
        storeName: "Stone Oak",
        templateId: "FoodSafety-StoneOak-v3",
        fieldPrefix: "SO",
        groupName: "B2 Kitchen Log",
        managerName: "Edga",
        managerPhone: "12109791918",
        managerDisplay: "+1 (210) 979-1918",
    },
    B3: {
        storeCode: "B3",
        storeId: "bandera",
        storeName: "Bandera",
        templateId: "FoodSafety-Bandera-v3",
        fieldPrefix: "BAN",
        groupName: "B3 Kitchen Log",
        managerName: "Miles",
        managerPhone: "12107712832",
        managerDisplay: "+1 (210) 771-2832",
    },
};

const PRODUCTION_GROUP_MAP = {
    "b1 kitchen log": STORE_CONFIG.B1,
    "b2 kitchen log": STORE_CONFIG.B2,
    "b3 kitchen log": STORE_CONFIG.B3,
};

const LOGTEST_GROUP_NAMES = ["ld agent-logtest", "ld agent logtest"];
const MANAGEMENT_GROUP_NAMES = ["bakudan management team"];

const ENABLED_GROUPS = [
    ...Object.keys(PRODUCTION_GROUP_MAP),
    ...LOGTEST_GROUP_NAMES,
    ...MANAGEMENT_GROUP_NAMES,
];

function normalize(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

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

function idMatches(chatId, envNames) {
    const id = String(chatId || "");
    return envNames.some((name) => parseEnvList(name).includes(id));
}

function configuredIdForStore(storeCode) {
    return parseEnvList(`FOOD_SAFETY_${storeCode}_GROUP_IDS`)
        .concat(parseEnvList(`FOOD_SAFETY_${storeCode}_GROUP_ID`));
}

function detectStoreFromGroupName(groupName) {
    const s = normalize(groupName);
    for (const [groupKey, info] of Object.entries(PRODUCTION_GROUP_MAP)) {
        if (s.includes(groupKey)) return { ...info };
    }

    if (/\bstone\s+oak\b/i.test(s)) return { ...STORE_CONFIG.B2 };
    if (/\bbandera\b/i.test(s)) return { ...STORE_CONFIG.B3 };
    if (/\b(the\s+rim|rim)\b/i.test(s) && !/\bprim/.test(s)) return { ...STORE_CONFIG.B1 };

    return null;
}

function getGroupScope(input = {}) {
    const chatId = input.chatId || input.chat_id || input.from || "";
    const chatName = input.chatName || input.chat_name || input.name || "";
    const normalizedName = normalize(chatName);

    for (const [groupKey, info] of Object.entries(PRODUCTION_GROUP_MAP)) {
        if (normalizedName.includes(groupKey) || configuredIdForStore(info.storeCode).includes(chatId)) {
            return {
                enabled: true,
                processingEnabled: true,
                role: "production_log",
                storeInfo: { ...info, routingSource: "production_group" },
                matchedBy: normalizedName.includes(groupKey) ? "name" : "env_group_id",
            };
        }
    }

    if (
        LOGTEST_GROUP_NAMES.some((name) => normalizedName.includes(name)) ||
        idMatches(chatId, ["FOOD_SAFETY_LOGTEST_GROUP_IDS", "FOOD_SAFETY_LOGTEST_GROUP_ID"])
    ) {
        return {
            enabled: true,
            processingEnabled: true,
            role: "logtest",
            storeInfo: null,
            matchedBy: LOGTEST_GROUP_NAMES.some((name) => normalizedName.includes(name)) ? "name" : "env_group_id",
        };
    }

    if (
        MANAGEMENT_GROUP_NAMES.some((name) => normalizedName.includes(name)) ||
        idMatches(chatId, ["FOOD_SAFETY_MANAGEMENT_GROUP_IDS", "FOOD_SAFETY_MANAGEMENT_GROUP_ID"])
    ) {
        return {
            enabled: true,
            processingEnabled: false,
            role: "management_alerts_only",
            storeInfo: null,
            matchedBy: MANAGEMENT_GROUP_NAMES.some((name) => normalizedName.includes(name)) ? "name" : "env_group_id",
        };
    }

    return {
        enabled: false,
        processingEnabled: false,
        role: "disabled",
        storeInfo: null,
        matchedBy: null,
    };
}

function isGroupEnabled(chatIdOrName, maybeName) {
    const scope = typeof chatIdOrName === "object"
        ? getGroupScope(chatIdOrName)
        : getGroupScope({ chatId: chatIdOrName, chatName: maybeName || chatIdOrName });
    return scope.enabled;
}

function isFoodSafetyProcessingGroup(chatIdOrName, maybeName) {
    const scope = typeof chatIdOrName === "object"
        ? getGroupScope(chatIdOrName)
        : getGroupScope({ chatId: chatIdOrName, chatName: maybeName || chatIdOrName });
    return scope.processingEnabled;
}

function countFieldIds(rawText) {
    const text = String(rawText || "").toUpperCase();
    const matches = text.match(/\b(?:RIM|IM|SO|BAN)\s*-?\s*\d{1,2}\b/g);
    return matches ? matches.length : 0;
}

function isFormLikely(rawText) {
    if (!rawText) return false;

    const text = normalize(rawText);
    const fieldCount = countFieldIds(rawText);
    const strongHeader = [
        "food safety",
        "food safety line check",
        "line check",
        "target range",
        "employee instructions",
        "corrective action",
        "manager review",
    ].some((needle) => text.includes(needle));
    const storeHeader = /\b(store|location)\s*:\s*(the rim|rim|stone oak|bandera)\b/i.test(rawText);
    const storeLineCheck = /\b(the rim|stone oak|bandera)\s+line\s+check\b/i.test(rawText);
    const hasShiftColumns = /(10\s*:?\s*00|10\s*am|11\s*:?\s*00|11\s*am)/i.test(rawText) &&
        /(4\s*:?\s*00|4\s*pm|16\s*:?\s*00)/i.test(rawText);
    const sectionLabels = [
        "walk-in cooler",
        "walk in cooler",
        "walk-in freezer",
        "walk in freezer",
        "prep area cooler",
        "bowl warmer",
        "ramen reach-in",
        "line freezer",
        "seasoned eggs",
        "sliced pork",
        "diced pork",
        "tapas reach-in",
        "chicken cold",
        "pork cold",
        "fryer",
        "pasta boiler",
    ];
    const sectionCount = sectionLabels.filter((needle) => text.includes(needle)).length;

    if (fieldCount >= 2) return true;
    if (/\bfood\s+safety\s+line\s+check\b/i.test(rawText)) return true;
    if (storeLineCheck) return true;
    if (strongHeader && (storeHeader || storeLineCheck || hasShiftColumns || sectionCount >= 1 || fieldCount >= 1)) return true;
    if (storeLineCheck && (hasShiftColumns || sectionCount >= 1 || fieldCount >= 1)) return true;
    if (storeHeader && hasShiftColumns) return true;
    if (sectionCount >= 3 && hasShiftColumns) return true;

    return false;
}

function detectStoreFromText(rawText) {
    if (!rawText) return null;
    const upper = String(rawText).toUpperCase();

    if (/STORE\s*:\s*(THE\s+RIM|RIM)\b/i.test(upper)) return "THE RIM";
    if (/STORE\s*:\s*STONE\s+OAK\b/i.test(upper)) return "STONE OAK";
    if (/STORE\s*:\s*BANDERA\b/i.test(upper)) return "BANDERA";

    if (/LOCATION\s*:\s*(THE\s+RIM|RIM)\b/i.test(upper)) return "THE RIM";
    if (/LOCATION\s*:\s*STONE\s+OAK\b/i.test(upper)) return "STONE OAK";
    if (/LOCATION\s*:\s*BANDERA\b/i.test(upper)) return "BANDERA";

    if (/STONE\s+OAK\s+LINE\s+CHECK/i.test(upper)) return "STONE OAK";
    if (/THE\s+RIM\s+LINE\s+CHECK/i.test(upper)) return "THE RIM";
    if (/BANDERA\s+LINE\s+CHECK/i.test(upper)) return "BANDERA";

    if (/\bRIM\s*-?\s*\d{1,2}\b/i.test(upper) && !/PRIM/i.test(upper)) return "THE RIM";
    if (/\bSO\s*-?\s*\d{1,2}\b/i.test(upper)) return "STONE OAK";
    if (/\bBAN\s*-?\s*\d{1,2}\b/i.test(upper)) return "BANDERA";

    if (/\bSTONE\s+OAK\b/i.test(upper)) return "STONE OAK";
    if (/\bBANDERA\b/i.test(upper)) return "BANDERA";
    if (/\b(THE\s+RIM|RIM)\b/i.test(upper) && !/PRIM/i.test(upper)) return "THE RIM";

    return null;
}

function storeNameToConfig(storeName) {
    const key = String(storeName || "").toUpperCase().trim();
    if (key === "THE RIM" || key === "RIM") return { ...STORE_CONFIG.B1 };
    if (key === "STONE OAK") return { ...STORE_CONFIG.B2 };
    if (key === "BANDERA") return { ...STORE_CONFIG.B3 };
    // Fuzzy fallback for common OCR variations
    if (/\bRIM\b/.test(key) && !/\bPRIM/.test(key)) return { ...STORE_CONFIG.B1 };
    if (/\bSTONE\s*OAK\b/.test(key)) return { ...STORE_CONFIG.B2 };
    if (/\bBANDERA\b/.test(key)) return { ...STORE_CONFIG.B3 };
    return null;
}

/**
 * Detect store from template field signature in raw text.
 * Looks for field ID patterns (RIM-xx, SO-xx, BAN-xx) to identify the store.
 */
function detectStoreFromTemplateSignature(rawText) {
    if (!rawText) return null;
    const upper = String(rawText).toUpperCase();

    // Strong signal: 3+ RIM-xx field IDs → The Rim
    const rimMatches = upper.match(/\bRIM\s*-?\s*\d{1,2}\b/g);
    if (rimMatches && rimMatches.length >= 3) return { ...STORE_CONFIG.B1 };

    // Strong signal: 3+ SO-xx field IDs → Stone Oak
    const soMatches = upper.match(/\bSO\s*-?\s*\d{1,2}\b/g);
    if (soMatches && soMatches.length >= 3) return { ...STORE_CONFIG.B2 };

    // Strong signal: 3+ BAN-xx field IDs → Bandera
    const banMatches = upper.match(/\bBAN\s*-?\s*\d{1,2}\b/g);
    if (banMatches && banMatches.length >= 3) return { ...STORE_CONFIG.B3 };

    // Weak signal: any RIM-xx (at least 1, no competing signals)
    if (rimMatches && rimMatches.length >= 1 && !soMatches && !banMatches) {
        return { ...STORE_CONFIG.B1 };
    }
    if (soMatches && soMatches.length >= 1 && !rimMatches && !banMatches) {
        return { ...STORE_CONFIG.B2 };
    }
    if (banMatches && banMatches.length >= 1 && !rimMatches && !soMatches) {
        return { ...STORE_CONFIG.B3 };
    }

    return null;
}

function resolveStoreFromContext(chatName, rawText, chatId) {
    const scope = getGroupScope({ chatId, chatName });

    // Production groups are authoritative — always resolve immediately
    if (scope.role === "production_log" && scope.storeInfo) {
        return { ...scope.storeInfo, routingSource: "production_group" };
    }

    // Priority 1: Header detection from form image text (works for any group)
    const textStore = detectStoreFromText(rawText);
    const textInfo = storeNameToConfig(textStore);
    if (textInfo) return { ...textInfo, routingSource: "form_header" };

    // Priority 2: Template signature — detect field prefix in raw text
    const templateStore = detectStoreFromTemplateSignature(rawText);
    if (templateStore) return { ...templateStore, routingSource: "template_signature" };

    // Priority 3: Group name detection (production groups only — logtest needs header/signature)
    const groupStore = detectStoreFromGroupName(chatName);
    if (groupStore && scope.role !== "logtest") {
        return { ...groupStore, routingSource: "group_name" };
    }

    // Logtest group with no header/signature match — return unresolved
    // (caller must ask for confirmation, never discard silently)
    return null;
}

function validateStoreGroupMatch(chatName, storeInfo, chatId) {
    const scope = getGroupScope({ chatId, chatName });
    if (scope.role !== "production_log" || !scope.storeInfo || !storeInfo) {
        return { valid: true };
    }

    if (scope.storeInfo.storeCode !== storeInfo.storeCode) {
        return {
            valid: false,
            message: "This form does not match this store group. Please upload the correct store form.",
            expected: scope.storeInfo,
            actual: storeInfo,
        };
    }
    return { valid: true };
}

function logRouterDecision(data = {}) {
    const payload = {
        event: "image_router_decision",
        message_id: data.message_id || "",
        chat_id: data.chat_id || "",
        chat_name: data.chat_name || "",
        image_hash: data.image_hash || "",
        dedupe_status: data.dedupe_status || "new",
        is_enabled_group: data.is_enabled_group === true,
        is_food_safety_form: data.is_food_safety_form === true,
        is_supporting_evidence: data.is_supporting_evidence === true,
        store_code: data.store_code || null,
        store_name: data.store_name || "",
        template_id: data.template_id || "",
        selected_column: data.selected_column || null,
        processing_path: data.processing_path || "silent",
        memory_used: data.memory_used === true,
        reply_count: data.reply_count || 0,
        final_status: data.final_status || "ignored",
    };
    logger.info("[ROUTER]", payload);
    return payload;
}

module.exports = {
    ENABLED_GROUPS,
    STORE_CONFIG,
    PRODUCTION_GROUP_MAP,
    LOGTEST_GROUP_NAMES,
    MANAGEMENT_GROUP_NAMES,
    getGroupScope,
    isGroupEnabled,
    isFoodSafetyProcessingGroup,
    isFormLikely,
    detectStoreFromText,
    detectStoreFromGroupName,
    detectStoreFromTemplateSignature,
    storeNameToConfig,
    resolveStoreFromContext,
    validateStoreGroupMatch,
    logRouterDecision,
};
