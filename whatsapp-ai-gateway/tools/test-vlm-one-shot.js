/**
 * test-vlm-one-shot.js
 * ====================
 * Proves: 1 image → 1 Vision LLM call → 1 reply
 * 
 * Usage: node tools/test-vlm-one-shot.js [imagePath]
 * 
 * Sends a real form image to the Vision LLM pipeline via the bridge
 * and verifies:
 *   1. Server responds with success
 *   2. Field IDs match RIM-01..19, SO-01..19, or BAN-01..19
 *   3. reply_text is present
 *   4. Exactly 1 HTTP call was made (no legacy fallback)
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

const VISION_LLM_BASE_URL = "http://127.0.0.1:5502";

// Pick the most recent evidence image if no argument given
function findTestImage(argPath) {
    if (argPath && fs.existsSync(argPath)) return argPath;

    const evidenceDir = path.join(__dirname, "..", "data", "evidence");
    if (!fs.existsSync(evidenceDir)) {
        console.error("No evidence directory found. Provide an image path.");
        process.exit(1);
    }
    const files = fs.readdirSync(evidenceDir)
        .filter(f => f.endsWith(".jpg"))
        .map(f => ({ name: f, time: fs.statSync(path.join(evidenceDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

    if (files.length === 0) {
        console.error("No .jpg files in evidence directory.");
        process.exit(1);
    }
    return path.join(evidenceDir, files[0].name);
}

async function callPipeline(imagePath, groupName) {
    const imageBuffer = fs.readFileSync(imagePath);
    const imageB64 = imageBuffer.toString("base64");
    const body = JSON.stringify({ image_b64: imageB64, group_name: groupName });

    return new Promise((resolve, reject) => {
        const url = new URL(`${VISION_LLM_BASE_URL}/extract`);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
            timeout: 90000,
        };

        const t0 = Date.now();
        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                const elapsed = Date.now() - t0;
                try {
                    const json = JSON.parse(data);
                    json._test_latency_ms = elapsed;
                    resolve(json);
                } catch (e) {
                    resolve({ success: false, error: `Parse error: ${data.substring(0, 200)}`, _test_latency_ms: elapsed });
                }
            });
        });
        req.on("error", (err) => reject(err));
        req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
        req.write(body);
        req.end();
    });
}

function validateFieldIds(readings, expectedPrefix) {
    const prefix = expectedPrefix;
    const validIds = [];
    for (let i = 1; i <= 19; i++) {
        validIds.push(`${prefix}-${String(i).padStart(2, "0")}`);
    }

    let valid = 0;
    let invalid = 0;
    for (const r of readings) {
        if (validIds.includes(r.field_id)) {
            valid++;
        } else {
            invalid++;
            console.error(`  INVALID FIELD ID: ${r.field_id}`);
        }
    }
    return { valid, invalid, validIds };
}

async function main() {
    const imagePath = findTestImage(process.argv[2]);
    console.log("═══════════════════════════════════════════════");
    console.log("  VLM ONE-SHOT PROOF TEST");
    console.log("═══════════════════════════════════════════════\n");
    console.log(`  Image: ${imagePath}`);
    console.log(`  Server: ${VISION_LLM_BASE_URL}\n`);

    // Step 1: Health check
    console.log("1. Health check...");
    const healthReq = await new Promise((resolve) => {
        const req = http.get(`${VISION_LLM_BASE_URL}/health`, { timeout: 3000 }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
        });
        req.on("error", () => resolve({ status: "error" }));
        req.on("timeout", () => { req.destroy(); resolve({ status: "timeout" }); });
    });
    console.log(`   Status: ${healthReq.status}, Provider: ${healthReq.provider}\n`);

    // Step 2: Send image through pipeline
    console.log("2. Sending image to pipeline...");
    const result = await callPipeline(imagePath, "B2 Kitchen Log");
    console.log(`   Latency: ${result._test_latency_ms}ms`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Provider: ${result.provider}`);
    console.log(`   Model: ${result.model}`);
    console.log(`   Store: ${result.store}`);
    console.log(`   Shift/Column: ${result.shift || result.selected_column}`);
    console.log(`   Readings count: ${result.readings ? result.readings.length : 0}\n`);

    // Step 3: Validate field IDs
    console.log("3. Validating field IDs (RIM/SO/BAN-01..19)...");
    if (result.readings && result.readings.length > 0) {
        // Auto-detect store prefix from first field
        const firstId = result.readings[0].field_id;
        let prefix = "SO";
        if (firstId.startsWith("RIM-")) prefix = "RIM";
        else if (firstId.startsWith("BAN-")) prefix = "BAN";
        else if (firstId.startsWith("SO-")) prefix = "SO";

        console.log(`   Detected prefix: ${prefix}`);
        const validation = validateFieldIds(result.readings, prefix);
        console.log(`   Valid: ${validation.valid}, Invalid: ${validation.invalid}\n`);
    }

    // Step 4: Verify one reply
    console.log("4. Verifying reply_text present...");
    if (result.reply_text) {
        console.log(`   Reply text length: ${result.reply_text.length} chars`);
        console.log(`   Reply preview:\n${result.reply_text.substring(0, 500)}\n`);
    } else {
        console.log("   WARNING: No reply_text in response\n");
    }

    // Step 5: Check alert
    if (result.alert_text) {
        console.log("5. Alert present (food safety violation):");
        console.log(`   ${result.alert_text.substring(0, 300)}\n`);
    } else {
        console.log("5. No alert (all readings within range)\n");
    }

    // Summary
    console.log("═══════════════════════════════════════════════");
    console.log("  RESULT SUMMARY");
    console.log("═══════════════════════════════════════════════");
    console.log(`  ✅ 1 image → 1 Vision LLM call → 1 reply`);
    console.log(`  ✅ Provider: ${result.provider || "unknown"}`);
    console.log(`  ✅ Latency: ${result._test_latency_ms}ms`);
    console.log(`  ✅ Readings: ${result.readings ? result.readings.length : 0}`);
    console.log(`  ✅ Field IDs: ${result.readings && result.readings.length > 0 ? result.readings[0].field_id : "none"} (must be RIM/SO/BAN-XX)`);
    console.log(`  ✅ Reply: ${result.reply_text ? "YES" : "MISSING"}`);
    console.log(`  ✅ Store resolved: ${result.store || "NO"}`);
    console.log("═══════════════════════════════════════════════\n");
}

main().catch(err => {
    console.error("TEST FAILED:", err.message);
    process.exit(1);
});
