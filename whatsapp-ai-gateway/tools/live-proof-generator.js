#!/usr/bin/env node
/**
 * live-proof-generator.js — DEV1 FINAL OCR ACCURACY PROOF
 *
 * Generates crop debug packages, field-by-field comparison tables,
 * root cause analysis, row drift checks, and the final report.
 *
 * Usage: node tools/live-proof-generator.js
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DB_PATH = path.join(__dirname, "..", "data", "gateway.db");
const ACCEPTANCE_DIR = path.join(__dirname, "..", "data", "acceptance");
const OUTPUT_BASE = path.join(__dirname, "..", "data", "debug-crops", "live-proof");
const REPORT_PATH = path.join(__dirname, "..", "FOOD_SAFETY_FIELD_LEVEL_LIVE_PROOF_REPORT.md");

const TEMPLATES = {
    "FoodSafety-StoneOak-v3": {
        storeCode: "B2", storeName: "Stone Oak", prefix: "SO",
        col10am: { x: 0.44, w: 0.18 },
        col4pm: { x: 0.62, w: 0.18 },
        fields: {
            "SO-01": { y1: 0.20, y2: 0.235, min: 30, max: 45, label: "Walk-In Cooler (Produce)" },
            "SO-02": { y1: 0.235, y2: 0.27, min: -20, max: 5, label: "Walk-In Freezer" },
            "SO-03": { y1: 0.27, y2: 0.305, min: 30, max: 45, label: "Prep Area Cooler" },
            "SO-04": { y1: 0.305, y2: 0.34, min: 100, max: 125, label: "Bowl Warmer" },
            "SO-05": { y1: 0.34, y2: 0.375, min: 30, max: 45, label: "Ramen Reach-In Top" },
            "SO-06": { y1: 0.375, y2: 0.41, min: 30, max: 45, label: "Ramen Reach-In Below" },
            "SO-07": { y1: 0.41, y2: 0.445, min: -20, max: 0, label: "Line Freezer" },
            "SO-08": { y1: 0.445, y2: 0.48, min: 95, max: 105, label: "Seasoned Eggs" },
            "SO-09": { y1: 0.48, y2: 0.515, min: 95, max: 105, label: "Sliced Pork Hot" },
            "SO-10": { y1: 0.515, y2: 0.55, min: 95, max: 105, label: "Diced Pork Hot" },
            "SO-11": { y1: 0.55, y2: 0.585, min: 30, max: 45, label: "Tapas Reach-In Top" },
            "SO-12": { y1: 0.585, y2: 0.62, min: 30, max: 40, label: "Chicken Cold" },
            "SO-13": { y1: 0.62, y2: 0.655, min: 30, max: 40, label: "Pork Cold" },
            "SO-14": { y1: 0.655, y2: 0.69, min: 30, max: 45, label: "Tapas Reach-In Below" },
            "SO-15": { y1: 0.69, y2: 0.725, min: 30, max: 45, label: "Walk-In Produce Recheck" },
            "SO-16": { y1: 0.725, y2: 0.76, min: 350, max: 360, label: "Fryer Left" },
            "SO-17": { y1: 0.76, y2: 0.795, min: 350, max: 360, label: "Fryer Right" },
            "SO-18": { y1: 0.795, y2: 0.83, min: 200, max: 220, label: "Pasta Boiler Left" },
            "SO-19": { y1: 0.83, y2: 0.865, min: 200, max: 220, label: "Pasta Boiler Right" },
        },
    },
    "FoodSafety-Bandera-v3": {
        storeCode: "B3", storeName: "Bandera", prefix: "BAN",
        col10am: { x: 0.40, w: 0.18 },
        col4pm: { x: 0.58, w: 0.18 },
        fields: {
            "BAN-01": { y1: 0.20, y2: 0.235, min: 30, max: 45, label: "Walk-In Cooler (Produce)" },
            "BAN-02": { y1: 0.235, y2: 0.27, min: -20, max: 5, label: "Walk-In Freezer" },
            "BAN-03": { y1: 0.27, y2: 0.305, min: 30, max: 45, label: "Prep Area Cooler" },
            "BAN-04": { y1: 0.305, y2: 0.34, min: 100, max: 125, label: "Bowl Warmer" },
            "BAN-05": { y1: 0.34, y2: 0.375, min: 30, max: 45, label: "Ramen Reach-In Top" },
            "BAN-06": { y1: 0.375, y2: 0.41, min: 30, max: 45, label: "Ramen Reach-In Below" },
            "BAN-07": { y1: 0.41, y2: 0.445, min: -20, max: 0, label: "Line Freezer" },
            "BAN-08": { y1: 0.445, y2: 0.48, min: 95, max: 105, label: "Seasoned Eggs" },
            "BAN-09": { y1: 0.48, y2: 0.515, min: 95, max: 105, label: "Sliced Pork Hot" },
            "BAN-10": { y1: 0.515, y2: 0.55, min: 95, max: 105, label: "Diced Pork Hot" },
            "BAN-11": { y1: 0.55, y2: 0.585, min: 30, max: 45, label: "Tapas Reach-In Top" },
            "BAN-12": { y1: 0.585, y2: 0.62, min: 30, max: 40, label: "Chicken Cold" },
            "BAN-13": { y1: 0.62, y2: 0.655, min: 30, max: 40, label: "Pork Cold" },
            "BAN-14": { y1: 0.655, y2: 0.69, min: 30, max: 45, label: "Tapas Reach-In Below" },
            "BAN-15": { y1: 0.69, y2: 0.725, min: 30, max: 45, label: "Walk-In Produce Recheck" },
            "BAN-16": { y1: 0.725, y2: 0.76, min: 350, max: 360, label: "Fryer Left" },
            "BAN-17": { y1: 0.76, y2: 0.795, min: 350, max: 360, label: "Fryer Right" },
            "BAN-18": { y1: 0.795, y2: 0.83, min: 200, max: 220, label: "Pasta Boiler Left" },
            "BAN-19": { y1: 0.83, y2: 0.865, min: 200, max: 220, label: "Pasta Boiler Right" },
        },
    },
};

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function toNum(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function inRng(v, mn, mx) { const n = toNum(v); return n !== null && n >= mn && n <= mx; }

async function loadDb() {
    const initSqlJs = require("sql.js");
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(buffer);
    return {
        getAll(sql, params) {
            const stmt = db.prepare(sql);
            if (params && params.length > 0) stmt.bind(params);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            stmt.free();
            return rows;
        },
    };
}

async function generateCrops(imagePath, templateId, outDir) {
    ensureDir(outDir);
    if (!fs.existsSync(imagePath)) { console.log("  [SKIP] Image not found:", imagePath); return null; }
    const tpl = TEMPLATES[templateId];
    if (!tpl) { console.log("  [SKIP] Unknown template:", templateId); return null; }

    const meta = await sharp(imagePath).metadata();
    const W = meta.width, H = meta.height;

    await sharp(imagePath).png().toFile(path.join(outDir, "aligned_form.png"));

    // Grid overlay SVG
    const rects = [];
    for (const [fid, f] of Object.entries(tpl.fields)) {
        for (const [ck, col] of [["10am", tpl.col10am], ["4pm", tpl.col4pm]]) {
            const rx = col.x * W, ry = f.y1 * H, rw = col.w * W, rh = (f.y2 - f.y1) * H;
            const color = ck === "10am" ? "#ff00ff" : "#00ffff";
            rects.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="${color}" stroke-width="1"/>`);
            if (ck === "10am") rects.push(`<text x="${rx + 2}" y="${ry + 12}" fill="#ffff00" font-size="10">${fid}</text>`);
        }
    }
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="none" stroke="#00ff00" stroke-width="2"/>${rects.join("")}</svg>`;
    await sharp(imagePath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(path.join(outDir, "grid_overlay.png"));

    // Individual crops
    const crops = {};
    for (const [fid, f] of Object.entries(tpl.fields)) {
        for (const [ck, col] of [["10AM", tpl.col10am], ["4PM", tpl.col4pm]]) {
            const x1 = Math.max(0, Math.floor(col.x * W));
            const y1 = Math.max(0, Math.floor(f.y1 * H));
            const x2 = Math.min(W, Math.ceil((col.x + col.w) * W));
            const y2 = Math.min(H, Math.ceil(f.y2 * H));
            const w = x2 - x1, h = y2 - y1;
            if (w > 0 && h > 0) {
                const cp = path.join(outDir, `${fid}_${ck}.png`);
                await sharp(imagePath).extract({ left: x1, top: y1, width: w, height: h }).resize(200, 60, { fit: "contain", background: { r: 255, g: 255, b: 255 } }).png().toFile(cp);
                crops[`${fid}_${ck}`] = { cropPath: path.relative(path.join(__dirname, ".."), cp), x1, y1, x2, y2, w, h };
            }
        }
    }
    return { W, H, crops };
}

function getFieldData(sub, tpl) {
    const items = sub.detected_items ? JSON.parse(sub.detected_items) : [];
    return items.map(item => {
        const fid = item.field_id || item.id;
        const fd = tpl.fields[fid];
        return {
            field_id: fid,
            label: fd ? fd.label : (item.label || fid),
            rawOcr: item._rawOcrValue !== undefined ? item._rawOcrValue : null,
            ocrConf: item.confidence || 0,
            memoryVal: (item._memoryMatches && item._memoryMatches[0]) ? item._memoryMatches[0].confirmed_value : null,
            memSim: (item._memoryMatches && item._memoryMatches[0]) ? (item._memoryMatches[0].similarity_score || 0) : 0,
            finalVal: item.detectedValue !== undefined ? item.detectedValue : item.value,
            src: item._predictionSource || "N/A",
            srcConf: item._predictionConfidence || item.confidence || 0,
            needsConf: item._needsConfirmation || false,
            alertOk: item._alertAllowed || false,
            alertReason: item._alertBlockReason || null,
            status: item.status || "UNKNOWN",
            rMin: fd ? fd.min : (item.range_min || -20),
            rMax: fd ? fd.max : (item.range_max || 450),
        };
    });
}

function getExpectedValues(storeCode) {
    const accFile = path.join(ACCEPTANCE_DIR, storeCode === "B2" ? "B2_stoneoak_4pm.json" : "B3_bandera_4pm.json");
    if (fs.existsSync(accFile)) return JSON.parse(fs.readFileSync(accFile, "utf8"));
    return {};
}

function rootCause(item, expected) {
    const fv = toNum(item.finalVal);
    const ev = toNum(expected);

    if (fv === null && ev === null) return { cause: "both_null", status: "PASS", detail: "Cell intentionally blank" };
    if (fv === null && ev !== null) return { cause: "ocr_failed", status: "FAIL", detail: "OCR returned null for expected value " + ev };
    if (fv !== null && ev === null) return { cause: "ocr_false_positive", status: "FAIL", detail: "OCR found value " + fv + " but cell should be blank" };

    if (fv === ev) return { cause: "exact_match", status: "PASS", detail: "OCR exact match" };
    if (Math.abs(fv - ev) <= 1) return { cause: "within_tolerance", status: "PASS", detail: "Within +/-1 tolerance" };

    const cat = (item.rMin >= 300) ? "FRYER" : (item.rMin >= 180) ? "BOILER" : "GENERAL";
    if (cat === "FRYER" && ev >= 300 && fv < 100) return { cause: "crop_wrong_or_ocr_digit_error", status: "FAIL", detail: "Fryer expected " + ev + " got " + fv + " — likely wrong cell crop or OCR digit confusion" };
    if (cat === "BOILER" && ev >= 150 && fv 