const Tesseract = require("tesseract.js");
const templateConfig = require("./formTemplates.json");
const logger = require("./logger");

const LOW_CONFIDENCE_THRESHOLD = 70;
const TOO_MANY_MISSING_RATIO = 0.35;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeText(text) {
    return String(text || "")
        .replace(/[^\S\r\n]+/g, " ")
        .replace(/[–—−]/g, "-")
        .replace(/[°º]/g, "")
        .trim();
}

function canonical(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function compact(value) {
    return canonical(value).replace(/\s+/g, "");
}

function templateAliases(template) {
    return [
        template.store_id,
        template.store_name,
        template.display_name,
        template.legacy_key,
        ...(template.group_aliases || []),
        ...(template.header_aliases || []),
    ].filter(Boolean);
}

function buildTemplates() {
    const templates = {};
    for (const [key, template] of Object.entries(templateConfig.templates)) {
        const copy = clone(template);
        copy.config_key = key;
        templates[key] = copy;
        templates[copy.legacy_key] = copy;
        templates[copy.store_name] = copy;
    }
    templates.default = templates.stone_oak;
    return templates;
}

const FORM_TEMPLATES = buildTemplates();

function getCanonicalTemplates() {
    return Object.values(templateConfig.templates).map((template) => FORM_TEMPLATES[template.store_id]);
}

function getTemplate(key) {
    if (!key) return null;
    const direct = FORM_TEMPLATES[key];
    if (direct) return direct;

    const wanted = compact(key);
    return getCanonicalTemplates().find((template) => {
        return templateAliases(template).some((alias) => compact(alias) === wanted || compact(alias).includes(wanted) || wanted.includes(compact(alias)));
    }) || null;
}

function envGroupTemplateMap() {
    const raw = process.env.FOOD_SAFETY_GROUP_TEMPLATE_MAP || process.env.FOOD_SAFETY_GROUP_STORE_MAP || "";
    if (!raw.trim()) return {};
    try {
        return JSON.parse(raw);
    } catch (err) {
        logger.warn("Invalid FOOD_SAFETY_GROUP_TEMPLATE_MAP JSON", { error: err.message });
        return {};
    }
}

function resolveGroupTemplate(context = {}) {
    const explicitStore = context.storeName || context.store_name || context.storeId || context.store_id || context.template || context.template_id;
    const explicitTemplate = getTemplate(explicitStore);
    if (explicitTemplate) {
        return { template: explicitTemplate, source: "group_mapping" };
    }

    const groupMap = envGroupTemplateMap();
    const chatId = context.chatId || context.chat_id || context.from || "";
    const chatName = context.chatName || context.chat_name || "";
    const haystack = canonical(`${chatId} ${chatName}`);

    for (const [groupKey, templateKey] of Object.entries(groupMap)) {
        if (haystack.includes(canonical(groupKey))) {
            const template = getTemplate(templateKey);
            if (template) return { template, source: "group_mapping" };
        }
    }

    for (const template of getCanonicalTemplates()) {
        const matched = (template.group_aliases || []).some((alias) => haystack.includes(canonical(alias)));
        if (matched) return { template, source: "group_mapping" };
    }

    return null;
}

function fieldIdPatternFor(item) {
    const escaped = item.id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const loose = item.id.replace("-", "\\s*-?\\s*");
    return new RegExp(`\\b(?:${escaped}|${loose})\\b`, "i");
}

function extractFieldIdHits(rawText) {
    const normalized = normalizeText(rawText).toUpperCase();
    const hits = [];
    // Match RIM-01, RIM01, IM-01, SO-01, BAN-01 etc.
    const regex = /\b(RIM|SO|IM|BAN)\s*-?\s*(\d{1,2})\b/g;
    let match;
    while ((match = regex.exec(normalized)) !== null) {
        const prefix = match[1];
        const num = String(parseInt(match[2], 10)).padStart(2, "0");
        // Normalize IM-xx to RIM-xx (legacy form compat)
        const canonicalPrefix = prefix === "IM" ? "RIM" : prefix;
        hits.push(`${canonicalPrefix}-${num}`);
    }
    return hits;
}

function detectTemplateByFieldIds(rawText) {
    const hits = extractFieldIdHits(rawText);
    if (hits.length === 0) return null;

    let best = null;
    for (const template of getCanonicalTemplates()) {
        const templateIds = new Set(template.items.map((item) => item.id.toUpperCase()));
        const count = hits.filter((hit) => templateIds.has(hit)).length;
        if (!best || count > best.count) {
            best = { template, count };
        }
    }

    if (best && best.count > 0) {
        return { template: best.template, source: "field_ids", fieldIdCount: best.count };
    }
    return null;
}

function detectTemplateByHeader(rawText) {
    const text = canonical(rawText);
    for (const template of getCanonicalTemplates()) {
        const matched = (template.header_aliases || []).some((alias) => text.includes(canonical(alias)));
        if (matched) return { template, source: "header" };
    }
    return null;
}

function detectTemplate(rawText, context = {}) {
    const group = resolveGroupTemplate(context);
    const fieldIds = detectTemplateByFieldIds(rawText);
    const header = detectTemplateByHeader(rawText);

    if (group) {
        return { ...group, fieldIdCount: fieldIds && fieldIds.template.store_id === group.template.store_id ? fieldIds.fieldIdCount : 0 };
    }
    if (fieldIds) return fieldIds;
    if (header) return header;

    const text = canonical(rawText);
    for (const template of getCanonicalTemplates()) {
        const signatureScore = templateAliases(template).filter((alias) => text.includes(canonical(alias))).length;
        if (signatureScore >= 2) {
            return { template, source: "visual_signature", signatureScore };
        }
    }

    return { template: FORM_TEMPLATES.default, source: "fallback", fieldIdCount: 0 };
}

function countTemplateFieldIds(rawText, template) {
    const normalized = normalizeText(rawText);
    return template.items.filter((item) => fieldIdPatternFor(item).test(normalized)).length;
}

function isLikelyFoodSafetyForm(rawText, template, detectionSource) {
    const text = canonical(rawText);
    const fieldCount = countTemplateFieldIds(rawText, template);

    // CEO Directive: STRICT FORM GATE
    // Non-form images (thermometer, egg, product, freezer photo) must be rejected.
    // A real food safety form requires MULTIPLE indicators, not just one keyword.

    // STRONG INDICATORS — form header/structure keywords
    const strongHeaderKeywords = [
        "food safety",
        "line check",
        "target range",
        "temperature items",
        "employee instructions",
        "manager review",
        "corrective action",
    ];
    const hasStrongHeader = strongHeaderKeywords.some(function (needle) { return text.includes(needle); });

    // STORE IDENTIFICATION — form header identifies a specific store
    const hasStoreIdentification = [
        "store bandera",
        "store rim",
        "store stone oak",
    ].some(function (needle) { return text.includes(needle); });

    // SHIFT COLUMNS — form has time columns (10:00 AM / 4:00 PM structure)
    const hasShiftColumns = (text.includes("10 00") || text.includes("11 00") || text.includes("1000") || text.includes("1100")) &&
        (text.includes("4 00") || text.includes("16 00") || text.includes("1600") || text.includes("400"));

    // FIELD IDs — form contains actual temperature field IDs (SO-01, RIM-01, BAN-01)
    const hasFieldIds = fieldCount >= 2; // Need at least 2 field IDs for form confidence

    // SECTION LABELS — form contains specific food safety section labels
    const sectionLabels = [
        "walk-in cooler",
        "walk-in freezer",
        "hot holding",
        "cooking temp",
        "prep cooler",
        "prep area cooler",
        "dishwasher sanitizer",
        "seasoned eggs",
        "sliced pork",
        "diced pork",
        "fryer",
        "pasta boiler",
        "bowl warmer",
        "ramen",
    ];
    const sectionLabelCount = sectionLabels.filter(function (needle) { return text.includes(needle); }).length;
    const hasMultipleSections = sectionLabelCount >= 2;

    // RULE 1: Strong header + any other indicator = form
    if (hasStrongHeader && (hasFieldIds || hasShiftColumns || hasMultipleSections || hasStoreIdentification)) return true;

    // RULE 2: Multiple field IDs detected = form (structure proves it's a form)
    if (fieldCount >= 3) return true;

    // RULE 3: Store identification + shift columns = form
    if (hasStoreIdentification && hasShiftColumns) return true;

    // RULE 4: Strong header alone (enough to identify as food safety form)
    if (hasStrongHeader) return true;

    // RULE 5: Multiple section labels with at least one field ID
    if (hasMultipleSections && fieldCount >= 1) return true;

    // RULE 6: field_ids detection with multiple fields
    if (detectionSource === "field_ids" && fieldCount >= 2) return true;

    // REJECT: Single generic keywords like "temperature" are NOT enough
    // This prevents thermometer photos, egg photos, product photos from triggering
    return false;
}

function detectShiftColumns(rawText, template) {
    const normalized = canonical(rawText);
    const detected = [];

    for (const column of template.shift_columns || []) {
        const found = (column.aliases || [column.id]).some((alias) => normalized.includes(canonical(alias)));
        if (found) {
            detected.push({ id: column.id, label: column.label });
        }
    }

    return detected;
}

function lineTokensForLabel(label) {
    return canonical(label)
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !["cooler", "freezer", "reach", "below", "left", "right"].includes(token));
}

function lineLooksLikeItem(line, item) {
    if (fieldIdPatternFor(item).test(line)) return true;
    // If line has a DIFFERENT field ID, skip (don't match label-only)
    if (/\b(?:RIM|SO|IM|BAN)\s*-?\s*\d{1,2}\b/i.test(line)) return false;
    const lineText = canonical(line);
    const tokens = lineTokensForLabel(item.label);
    if (tokens.length === 0) return false;
    const matches = tokens.filter((token) => lineText.includes(token)).length;
    return matches >= Math.min(2, tokens.length);
}

function rowsForTemplate(rawText, template) {
    const lines = normalizeText(rawText).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rows = new Map();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const item of template.items) {
            if (!rows.has(item.id) && lineLooksLikeItem(line, item)) {
                let row = line;
                if (extractNumbers(row, item, template.shift_columns || []).length === 0) {
                    row = [line, lines[i + 1] || "", lines[i + 2] || ""].join(" ");
                }
                rows.set(item.id, row);
            }
        }
    }

    return rows;
}

function removeExpectedRange(text, item) {
    const min = String(item.safeRange.min).replace("-", "\\-?");
    const max = String(item.safeRange.max).replace("-", "\\-?");
    const range = new RegExp(`${min}\\s*(?:F|DEG|DEGREES|)?\\s*[-TO]+\\s*${max}\\s*(?:F|DEG|DEGREES|)?`, "ig");
    return text.replace(range, " ");
}

function cleanRowForNumbers(rowText, item, columns) {
    let cleaned = normalizeText(rowText);
    cleaned = cleaned.replace(fieldIdPatternFor(item), " ");
    cleaned = removeExpectedRange(cleaned, item);
    for (const column of columns || []) {
        for (const alias of column.aliases || [column.id, column.label]) {
            const escaped = alias.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            cleaned = cleaned.replace(new RegExp(escaped, "ig"), " ");
        }
    }
    cleaned = cleaned.replace(/\b(?:AM|PM|TEMPERATURE|TARGET|RANGE|ITEM|ID|NOTES|CORRECTIVE|ACTION|EMPLOYEE)\b/ig, " ");
    return cleaned;
}

function extractNumbers(rowText, item, columns) {
    const cleaned = cleanRowForNumbers(rowText, item, columns);
    const values = [];
    const regex = /-?\d{1,3}(?:\.\d+)?/g;
    let match;
    while ((match = regex.exec(cleaned)) !== null) {
        const value = parseFloat(match[0]);
        if (Number.isFinite(value) && value >= -40 && value <= 450) {
            values.push(value);
        }
    }
    return values;
}

function numberConfidence(value) {
    return value === null || value === undefined ? 0 : 0.91;
}

function statusForValue(value, item) {
    if (value === null || value === undefined) return "MISSING";
    return value >= item.safeRange.min && value <= item.safeRange.max ? "SAFE" : "UNSAFE";
}

function buildItemResult(item, index, value, valuesByColumn = {}) {
    const status = statusForValue(value, item);
    return {
        index,
        id: item.id,
        field_id: item.id,
        label: item.label,
        item: item.label,
        detectedValue: value === undefined ? null : value,
        value: value === undefined ? null : value,
        detectedValues: valuesByColumn,
        unit: item.unit,
        safeRange: item.safeRange,
        range_min: item.safeRange.min,
        range_max: item.safeRange.max,
        confidence: numberConfidence(value),
        isSafe: status === "SAFE",
        status,
    };
}

function parseRows(rawText, template, detectedColumns, selectedColumn) {
    const rows = rowsForTemplate(rawText, template);
    const items = [];
    const columnsForParsing = template.shift_columns || [];

    for (let i = 0; i < template.items.length; i++) {
        const item = template.items[i];
        const row = rows.get(item.id) || "";
        let numbers = row ? extractNumbers(row, item, columnsForParsing) : [];

        if (numbers.length === 0 && rows.size === 0) {
            const fallbackNumbers = extractNumbers(rawText, item, columnsForParsing);
            numbers = fallbackNumbers.slice(i, i + 1);
        }

        const valuesByColumn = {};
        if (detectedColumns.length > 1 && numbers.length >= detectedColumns.length) {
            detectedColumns.forEach((column, colIndex) => {
                valuesByColumn[column.id] = numbers[colIndex];
            });
        } else if (detectedColumns.length === 1 && numbers.length >= 1) {
            valuesByColumn[detectedColumns[0].id] = numbers[0];
        }

        let value = null;
        if (selectedColumn && Object.prototype.hasOwnProperty.call(valuesByColumn, selectedColumn)) {
            value = valuesByColumn[selectedColumn];
        } else if (detectedColumns.length <= 1 && numbers.length > 0) {
            value = numbers[0];
        } else if (detectedColumns.length > 1 && selectedColumn) {
            value = null;
        }

        items.push(buildItemResult(item, i + 1, value, valuesByColumn));
    }

    return items;
}

function buildIssues(items) {
    const issues = [];
    for (const item of items) {
        if (item.status === "UNSAFE") {
            issues.push({
                type: "UNSAFE_TEMP",
                item: item.label,
                id: item.id,
                detected: `${item.detectedValue}${item.unit}`,
                range: `${item.safeRange.min}-${item.safeRange.max}${item.unit}`,
                index: item.index,
            });
        } else if (item.status === "MISSING") {
            issues.push({
                type: "MISSING_FIELD",
                item: item.label,
                id: item.id,
                index: item.index,
            });
        }
    }
    return issues;
}

function autoSelectColumnFromItems(items, detectedColumns) {
    if (!detectedColumns || detectedColumns.length === 0) return null;
    const ids = detectedColumns.map((column) => column.id);
    const tenId = ids.find((id) => canonical(id).includes("10") || canonical(id).includes("11")) || ids[0];
    const fourId = ids.find((id) => canonical(id).includes("16") || canonical(id).includes("4")) || ids[1];

    let tenFilled = 0;
    let fourFilled = 0;
    for (const item of items || []) {
        const values = item.detectedValues || {};
        if (tenId && values[tenId] !== null && values[tenId] !== undefined) tenFilled++;
        if (fourId && values[fourId] !== null && values[fourId] !== undefined) fourFilled++;
    }

    if (tenFilled > 0 && fourFilled === 0) return tenId;
    if (fourFilled > 0) return fourId;
    if (detectedColumns.length === 1 && tenFilled + fourFilled > 0) return detectedColumns[0].id;
    return null;
}

function applySelectedColumn(items, selectedColumn) {
    if (!selectedColumn) return items;
    return (items || []).map((item) => {
        const values = item.detectedValues || {};
        const value = Object.prototype.hasOwnProperty.call(values, selectedColumn)
            ? values[selectedColumn]
            : item.detectedValue;
        return buildItemResult(item, item.index, value, values);
    });
}

function parseTemperatures(rawText, storeName = "StoneOak", options = {}) {
    if (typeof storeName === "object") {
        options = storeName;
        storeName = options.storeName || options.store_id || null;
    }

    const context = { ...(options.context || {}) };
    if (storeName) context.storeName = storeName;
    const detection = detectTemplate(rawText, context);
    const template = detection.template || FORM_TEMPLATES.default;
    const isForm = isLikelyFoodSafetyForm(rawText, template, detection.source);

    if (!isForm) {
        return {
            store_id: template.store_id,
            storeName: template.store_name,
            store_name: template.store_name,
            template_id: null,
            template: null,
            template_detection_source: detection.source,
            isForm: false,
            classification: "EVIDENCE_ONLY",
            shift_columns_detected: [],
            selected_column: null,
            items: [],
            issues: [],
            confidence: 0,
            needsReview: true,
        };
    }

    const detectedColumns = detectShiftColumns(rawText, template);
    const initialItems = parseRows(rawText, template, detectedColumns, null);
    const selectedColumn = normalizeSelectedColumn(options.selectedColumn, template) ||
        autoSelectColumnFromItems(initialItems, detectedColumns);
    const items = applySelectedColumn(initialItems, selectedColumn);
    const issues = buildIssues(items);
    const missingCount = issues.filter((issue) => issue.type === "MISSING_FIELD").length;

    return {
        store_id: template.store_id,
        storeName: template.store_name,
        store_name: template.store_name,
        template_id: template.template_id,
        template: template.legacy_key || template.store_name,
        template_detection_source: detection.source,
        isForm: true,
        classification: "FOOD_SAFETY_FORM",
        shift_columns_detected: detectedColumns.map((column) => column.id),
        shift_columns: detectedColumns,
        selected_column: selectedColumn,
        items,
        issues,
        confidence: 0,
        needsColumnSelection: detectedColumns.length > 0 && !selectedColumn,
        tooManyMissingFields: missingCount >= Math.ceil(items.length * TOO_MANY_MISSING_RATIO),
        needsReview: false,
    };
}

function normalizeSelectedColumn(input, template) {
    if (!input) return null;
    const wanted = canonical(String(input));
    const columns = template.shift_columns || [];

    if (wanted === "1") return columns[0] && columns[0].id;
    if (wanted === "2") return columns[1] && columns[1].id;

    for (const column of columns) {
        const aliases = [column.id, column.label, ...(column.aliases || [])];
        if (aliases.some((alias) => canonical(alias) === wanted || canonical(alias).includes(wanted) || wanted.includes(canonical(alias)))) {
            return column.id;
        }
    }
    return null;
}

function selectParsedColumn(parsed, columnInput) {
    const template = getTemplate(parsed.store_id || parsed.template || parsed.storeName);
    if (!template) return null;
    const selectedColumn = normalizeSelectedColumn(columnInput, template);
    if (!selectedColumn) return null;

    const items = parsed.items.map((item) => {
        const value = Object.prototype.hasOwnProperty.call(item.detectedValues || {}, selectedColumn)
            ? item.detectedValues[selectedColumn]
            : null;
        return buildItemResult(item, item.index, value, item.detectedValues || {});
    });
    const issues = buildIssues(items);
    const missingCount = issues.filter((issue) => issue.type === "MISSING_FIELD").length;

    return {
        ...parsed,
        selected_column: selectedColumn,
        selected_column_label: (template.shift_columns || []).find((column) => column.id === selectedColumn)?.label || selectedColumn,
        needsColumnSelection: false,
        items,
        issues,
        tooManyMissingFields: missingCount >= Math.ceil(items.length * TOO_MANY_MISSING_RATIO),
    };
}

function applyOcrConfidence(parsed, confidence) {
    const result = { ...parsed, confidence };
    result.needsReview = confidence < LOW_CONFIDENCE_THRESHOLD || result.tooManyMissingFields;
    result.status = result.needsReview ? "NEEDS_REVIEW" : "PENDING";
    return result;
}

function buildOcrJson(rawText, parsed, extra = {}) {
    return JSON.stringify({
        store_id: parsed.store_id,
        store_name: parsed.store_name || parsed.storeName,
        template_id: parsed.template_id,
        template: parsed.template,
        template_detection_source: parsed.template_detection_source,
        is_form: parsed.isForm,
        classification: parsed.classification,
        shift_columns_detected: parsed.shift_columns_detected || [],
        selected_column: parsed.selected_column || null,
        rawText,
        confidence: parsed.confidence,
        items: (parsed.items || []).map((item) => ({
            field_id: item.field_id || item.id,
            id: item.id || item.field_id,
            item: item.item || item.label,
            label: item.label || item.item,
            range_min: item.range_min ?? item.safeRange?.min,
            range_max: item.range_max ?? item.safeRange?.max,
            safeRange: item.safeRange || { min: item.range_min, max: item.range_max },
            value: item.value ?? item.detectedValue,
            detectedValue: item.detectedValue ?? item.value,
            detectedValues: item.detectedValues || {},
            unit: item.unit || "F",
            confidence: item.confidence,
            status: item.status,
        })),
        issues: parsed.issues || [],
        status: parsed.status,
        ...extra,
    });
}

async function performOCR(imagePath) {
    logger.info("Starting OCR", { imagePath });
    try {
        const result = await Tesseract.recognize(imagePath, "eng", {
            logger: (m) => {
                if (m.status === "recognizing text") {
                    logger.debug("OCR progress", { progress: Math.round(m.progress * 100) + "%" });
                }
            },
        });

        const text = result.data.text;
        const confidence = result.data.confidence;
        logger.info("OCR completed", { confidence, textLength: text.length });

        return {
            rawText: text,
            confidence,
            words: result.data.words || [],
            lines: result.data.lines || [],
        };
    } catch (err) {
        logger.error("OCR failed", { error: err.message });
        throw err;
    }
}

function formatDetectedSummary(parsed, lang = "ES") {
    const isES = String(lang || "ES").toUpperCase() === "ES";
    const header = isES ? "Valores detectados:" : "Detected values:";
    const lines = [header, ""];

    for (const item of parsed.items || []) {
        const statusEmoji = item.status === "SAFE" ? "OK" : item.status === "UNSAFE" ? "WARN" : "MISS";
        const value = item.detectedValue !== null && item.detectedValue !== undefined ? `${item.detectedValue}${item.unit}` : isES ? "No detectado" : "Not detected";
        const range = `${item.safeRange.min}-${item.safeRange.max}${item.unit}`;
        lines.push(`${statusEmoji} ${item.id} - ${item.label}: ${value} (${isES ? "Rango" : "Range"}: ${range})`);
    }

    return lines.join("\n");
}

module.exports = {
    LOW_CONFIDENCE_THRESHOLD,
    FORM_TEMPLATES,
    performOCR,
    parseTemperatures,
    formatDetectedSummary,
    detectTemplate,
    detectShiftColumns,
    selectParsedColumn,
    applyOcrConfidence,
    buildOcrJson,
    normalizeSelectedColumn,
};
