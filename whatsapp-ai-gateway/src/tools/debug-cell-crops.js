/**
 * debug-cell-crops.js — Phase 2: Cell Crop Debugger
 *
 * For every uploaded form, generates debug images showing:
 *   - full_aligned.png     : the aligned/form-corrected full form
 *   - grid_overlay.png     : detected grid lines overlaid
 *   - SO-01_10AM.png ...  : individual cell crops
 *
 * Usage:
 *   node src/tools/debug-cell-crops.js <submission_id>
 *   node src/tools/debug-cell-crops.js --batch <submission_id_1> <submission_id_2> ...
 *   node src/tools/debug-cell-crops.js --all  (all pending submissions)
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DEBUG_BASE = path.join(__dirname, "..", "..", "data", "debug-crops");
const CROPS_BASE = path.join(__dirname, "..", "..", "data", "handwriting", "crops");

// Template cell coordinate maps (normalized 0-1)
// These must match what the Python cell_extractor.py uses.
const TEMPLATE_COORDS = {
    "FoodSafety-StoneOak-v3": { fieldPrefix: "SO", fields: 19, col10am: 0.30, col4pm: 0.55 },
    "FoodSafety-Rim-v3": { fieldPrefix: "RIM", fields: 19, col10am: 0.30, col4pm: 0.55 },
    "FoodSafety-Bandera-v3": { prefix: "BAN", fields: 19, col10am: 0.30, col4pm: 0.55 },
};

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function loadImage(imagePath) {
    if (!fs.existsSync(imagePath)) {
        return null;
    }
    return sharp(imagePath).metadata().then(meta => ({ path: imagePath, meta }));
}

async function cropCell(imagePath, outPath, x1, y1, x2, y2) {
    if (!fs.existsSync(imagePath)) return false;
    try {
        const meta = await sharp(imagePath).metadata();
        const imgW = meta.width;
        const imgH = meta.height;
        const px1 = Math.max(0, Math.floor(x1 * imgW));
        const py1 = Math.max(0, Math.floor(y1 * imgH));
        const px2 = Math.min(imgW, Math.ceil(x2 * imgW));
        const py2 = Math.min(imgH, Math.ceil(y2 * imgH));
        if (px2 <= px1 || py2 <= py1) return false;
        await sharp(imagePath)
            .extract({ left: px1, top: py1, width: px2 - px1, height: py2 - py1 })
            .resize(200, 60, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
            .png()
            .toFile(outPath);
        return true;
    } catch (err) {
        console.error(`Failed to crop cell: ${err.message}`);
        return false;
    }
}

async function drawGridOverlay(imagePath, outPath, fieldRows, colX1, colX2) {
    if (!fs.existsSync(imagePath)) return;
    const meta = await sharp(imagePath).metadata();
    const W = meta.width;
    const H = meta.height;

    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="none" stroke="#00ff00" stroke-width="2"/>
  ${fieldRows.map((r, i) => {
        const y1 = r.y1 * H;
        const y2 = r.y2 * H;
        return `<rect x="${colX1 * W}" y="${y1}" width="${(colX2 - colX1) * W}" height="${y2 - y1}" fill="none" stroke="#ff00ff" stroke-width="1"/>
  <text x="${colX1 * W + 2}" y="${y1 + 12}" fill="#ffff00" font-size="12">${r.label}</text>`;
    }).join("\n")}
  <line x1="${colX1 * W}" y1="0" x2="${colX1 * W}" y2="${H}" stroke="#00ff00" stroke-width="2"/>
  <line x1="${colX2 * W}" y1="0" x2="${colX2 * W}" y2="${H}" stroke="#00ff00" stroke-width="2"/>
</svg>`;

    await sharp(imagePath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(outPath);
}

async function generateFieldRows(templateId, fieldCount) {
    // Standard 19-row food safety form
    const headerHeight = 0.12;
    const footerHeight = 0.05;
    const availableH = 1 - headerHeight - footerHeight;
    const rowH = availableH / fieldCount;

    const rows = [];
    for (let i = 0; i < fieldCount; i++) {
        rows.push({
            y1: headerHeight + i * rowH,
            y2: headerHeight + (i + 1) * rowH,
            label: `Field ${i + 1}`,
        });
    }
    return rows;
}

async function processSubmission(submissionId, imagePath, templateId, outDir) {
    ensureDir(outDir);

    const coords = TEMPLATE_COORDS[templateId] || { col10am: 0.30, col4pm: 0.55 };
    const fieldCount = coords.fields || 19;

    // Copy full image
    if (fs.existsSync(imagePath)) {
        await sharp(imagePath).png().toFile(path.join(outDir, "full_aligned.png"));
    }

    // Generate field rows
    const fieldRows = await generateFieldRows(templateId, fieldCount);

    // Draw grid overlay
    const col10am = coords.col10am || 0.30;
    const col4pm = coords.col4pm || 0.55;
    const colWidth = 0.10;

    await drawGridOverlay(imagePath, path.join(outDir, "grid_overlay.png"), fieldRows, col10am, col10am + colWidth);
    await drawGridOverlay(imagePath, path.join(outDir, "grid_overlay_4pm.png"), fieldRows, col4pm, col4pm + colWidth);

    // Crop each cell
    let cropsOk = 0;
    let cropsFail = 0;
    for (let i = 0; i < fieldCount; i++) {
        const row = fieldRows[i];
        const fieldNum = String(i + 1).padStart(2, "0");
        const prefix = coords.prefix || coords.fieldPrefix || "FIELD";

        // 10AM cell
        const p10am = path.join(outDir, `${prefix}-${fieldNum}_10AM.png`);
        if (await cropCell(imagePath, p10am, col10am, row.y1, col10am + colWidth, row.y2)) {
            cropsOk++;
        } else {
            cropsFail++;
        }

        // 4PM cell
        const p4pm = path.join(outDir, `${prefix}-${fieldNum}_4PM.png`);
        if (await cropCell(imagePath, p4pm, col4pm, row.y1, col4pm + colWidth, row.y2)) {
            cropsOk++;
        } else {
            cropsFail++;
        }
    }

    // Save metadata
    const meta = {
        submission_id: submissionId,
        template_id: templateId,
        image_path: imagePath,
        generated_at: new Date().toISOString(),
        cells_total: fieldCount * 2,
        cells_ok: cropsOk,
        cells_failed: cropsFail,
    };
    fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

    console.log(`[DEBUG_CROPS] ${submissionId}: ${cropsOk} crops OK, ${cropsFail} failed`);
    return meta;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log("Usage: node src/tools/debug-cell-crops.js <submission_id> [template_id]");
        console.log("       node src/tools/debug-cell-crops.js --batch <id1> <id2> ...");
        console.log("       node src/tools/debug-cell-crops.js --all");
        process.exit(1);
    }

    const db = require("../../database");
    await db.getDb();

    if (args[0] === "--batch") {
        const ids = args.slice(1);
        for (const id of ids) {
            await runForSubmission(id, db);
        }
    } else if (args[0] === "--all") {
        const subs = db.getAll("SELECT id, image_path, template_id FROM food_safety_submissions WHERE image_path IS NOT NULL AND image_path != '' ORDER BY created_at DESC LIMIT 10");
        for (const sub of subs) {
            await runForSubmission(String(sub.id), db, sub.image_path, sub.template_id);
        }
    } else {
        await runForSubmission(args[0], db, args[1], args[2]);
    }
}

async function runForSubmission(submissionId, db, imagePath, templateId) {
    if (!imagePath) {
        const sub = db.getOne("SELECT image_path, template_id FROM food_safety_submissions WHERE id = ?", [submissionId]);
        if (!sub) { console.error(`Submission ${submissionId} not found`); return; }
        imagePath = sub.image_path;
        templateId = sub.template_id;
    }

    const safeId = String(submissionId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const outDir = path.join(DEBUG_BASE, safeId);

    try {
        await processSubmission(submissionId, imagePath, templateId || "FoodSafety-StoneOak-v3", outDir);
    } catch (err) {
        console.error(`[DEBUG_CROPS] Error processing ${submissionId}: ${err.message}`);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { processSubmission, generateFieldRows };
