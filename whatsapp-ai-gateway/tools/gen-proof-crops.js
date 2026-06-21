#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const TPLS = {
    "FoodSafety-StoneOak-v3": {
        prefix: "SO",
        col10am: { x: 0.44, w: 0.18 }, col4pm: { x: 0.62, w: 0.18 },
        fields: {
            "SO-01": { y1: 0.20, y2: 0.235 }, "SO-02": { y1: 0.235, y2: 0.27 },
            "SO-03": { y1: 0.27, y2: 0.305 }, "SO-04": { y1: 0.305, y2: 0.34 },
            "SO-05": { y1: 0.34, y2: 0.375 }, "SO-06": { y1: 0.375, y2: 0.41 },
            "SO-07": { y1: 0.41, y2: 0.445 }, "SO-08": { y1: 0.445, y2: 0.48 },
            "SO-09": { y1: 0.48, y2: 0.515 }, "SO-10": { y1: 0.515, y2: 0.55 },
            "SO-11": { y1: 0.55, y2: 0.585 }, "SO-12": { y1: 0.585, y2: 0.62 },
            "SO-13": { y1: 0.62, y2: 0.655 }, "SO-14": { y1: 0.655, y2: 0.69 },
            "SO-15": { y1: 0.69, y2: 0.725 }, "SO-16": { y1: 0.725, y2: 0.76 },
            "SO-17": { y1: 0.76, y2: 0.795 }, "SO-18": { y1: 0.795, y2: 0.83 },
            "SO-19": { y1: 0.83, y2: 0.865 },
        },
    },
    "FoodSafety-Bandera-v3": {
        prefix: "BAN",
        col10am: { x: 0.40, w: 0.18 }, col4pm: { x: 0.58, w: 0.18 },
        fields: {
            "BAN-01": { y1: 0.20, y2: 0.235 }, "BAN-02": { y1: 0.235, y2: 0.27 },
            "BAN-03": { y1: 0.27, y2: 0.305 }, "BAN-04": { y1: 0.305, y2: 0.34 },
            "BAN-05": { y1: 0.34, y2: 0.375 }, "BAN-06": { y1: 0.375, y2: 0.41 },
            "BAN-07": { y1: 0.41, y2: 0.445 }, "BAN-08": { y1: 0.445, y2: 0.48 },
            "BAN-09": { y1: 0.48, y2: 0.515 }, "BAN-10": { y1: 0.515, y2: 0.55 },
            "BAN-11": { y1: 0.55, y2: 0.585 }, "BAN-12": { y1: 0.585, y2: 0.62 },
            "BAN-13": { y1: 0.62, y2: 0.655 }, "BAN-14": { y1: 0.655, y2: 0.69 },
            "BAN-15": { y1: 0.69, y2: 0.725 }, "BAN-16": { y1: 0.725, y2: 0.76 },
            "BAN-17": { y1: 0.76, y2: 0.795 }, "BAN-18": { y1: 0.795, y2: 0.83 },
            "BAN-19": { y1: 0.83, y2: 0.865 },
        },
    },
};

async function genCrops(imgPath, outDir, templateId) {
    fs.mkdirSync(outDir, { recursive: true });
    if (!fs.existsSync(imgPath)) { console.log("SKIP - no image:", imgPath); return; }
    const tpl = TPLS[templateId];
    if (!tpl) { console.log("SKIP - no template:", templateId); return; }

    const meta = await sharp(imgPath).metadata();
    const W = meta.width, H = meta.height;
    console.log("Image:", path.basename(imgPath), W + "x" + H);

    await sharp(imgPath).png().toFile(path.join(outDir, "aligned_form.png"));

    const rects = [];
    for (const [fid, f] of Object.entries(tpl.fields)) {
        for (const [ck, col] of [["10am", tpl.col10am], ["4pm", tpl.col4pm]]) {
            const rx = col.x * W, ry = f.y1 * H, rw = col.w * W, rh = (f.y2 - f.y1) * H;
            const c = ck === "10am" ? "#ff00ff" : "#00ffff";
            rects.push('<rect x="' + rx + '" y="' + ry + '" width="' + rw + '" height="' + rh + '" fill="none" stroke="' + c + '" stroke-width="1"/>');
            if (ck === "10am") rects.push('<text x="' + (rx + 2) + '" y="' + (ry + 12) + '" fill="#ffff00" font-size="10">' + fid + "</text>");
        }
    }
    const svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg"><rect width="' + W + '" height="' + H + '" fill="none" stroke="#00ff00" stroke-width="2"/>' + rects.join("") + "</svg>";
    await sharp(imgPath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(path.join(outDir, "grid_overlay.png"));

    let count = 0;
    for (const [fid, f] of Object.entries(tpl.fields)) {
        for (const [ck, col] of [["10AM", tpl.col10am], ["4PM", tpl.col4pm]]) {
            const x1 = Math.max(0, Math.floor(col.x * W));
            const y1 = Math.max(0, Math.floor(f.y1 * H));
            const x2 = Math.min(W, Math.ceil((col.x + col.w) * W));
            const y2 = Math.min(H, Math.ceil(f.y2 * H));
            const w = x2 - x1, h = y2 - y1;
            if (w > 0 && h > 0) {
                await sharp(imgPath)
                    .extract({ left: x1, top: y1, width: w, height: h })
                    .resize(200, 60, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
                    .png()
                    .toFile(path.join(outDir, fid + "_" + ck + ".png"));
                count++;
            }
        }
    }
    console.log("Generated", count, "crops in", outDir);
}

// Main
const base = path.join(__dirname, "..", "data", "debug-crops", "live-proof");

// B2 Stone Oak - Submission 44 (latest with valid image)
genCrops(
    path.join(__dirname, "..", "data", "evidence", "evidence_1781927883937_936f42a9.jpg"),
    path.join(base, "B2", "44"),
    "FoodSafety-StoneOak-v3"
).then(() => {
    // B3 Bandera - Submission 40 (latest Bandera with valid image)
    return genCrops(
        path.join(__dirname, "..", "data", "evidence", "evidence_1781918501314_93b89c46.jpg"),
        path.join(base, "B3", "40"),
        "FoodSafety-Bandera-v3"
    );
}).then(() => {
    console.log("All crops generated successfully.");
}).catch(err => {
    console.error("Error:", err.message);
});
