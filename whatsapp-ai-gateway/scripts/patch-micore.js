/**
 * Helper: patch foodSafetyHandler.js to add mi-core-client require and sync call.
 * Run once: node scripts/patch-micore.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "src", "foodSafetyHandler.js");
let content = fs.readFileSync(file, "utf8");
let changes = 0;

// Normalize: work with \n internally, write back as-is
const nl = content.includes("\r\n") ? "\r\n" : "\n";

// 1) Add require after numericTextHandler require
const reqNeedle = `const numericTextHandler = require("./numericTextHandler");`;
const reqReplace = `const numericTextHandler = require("./numericTextHandler");${nl}const miCore = require("./mi-core-client");`;
if (content.includes(reqNeedle) && !content.includes("mi-core-client")) {
    content = content.replace(reqNeedle, reqReplace);
    changes++;
    console.log("✅ Added mi-core-client require");
} else if (content.includes("mi-core-client")) {
    console.log("⏭️  mi-core-client require already present");
} else {
    console.error("❌ Could not find numericTextHandler require");
}

// 2) Add miCore.syncSubmission after the gsheet sync .catch block
// Find the exact .catch block end in the CONFIRM flow
const catchNeedle = `logger.warn("Google Sheet sync failed (non-blocking, queued for retry)", { error: sheetErr.message });`;
const idx = content.indexOf(catchNeedle);
if (idx !== -1) {
    // Find the end of that .catch block: the }); closing
    const afterCatch = content.substring(idx + catchNeedle.length);
    const closeIdx = afterCatch.indexOf("});");
    if (closeIdx !== -1 && !content.includes("Mi-Core sync")) {
        // Insert after the .catch closing });
        const insertAt = idx + catchNeedle.length + closeIdx + 3; // after "});"
        const miCoreCall = `${nl}            // Mi-Core sync (non-blocking, fire-and-forget)${nl}            if (miCore.isConfigured()) {${nl}                miCore.syncSubmission(sub, (sub.parsed && sub.parsed.items) || [], sub.traceId || null)${nl}                    .catch((miErr) => logger.warn("[MI_CORE] Submission sync failed (non-blocking)", { error: miErr.message }));${nl}            }`;
        content = content.substring(0, insertAt) + miCoreCall + content.substring(insertAt);
        changes++;
        console.log("✅ Added miCore.syncSubmission in CONFIRM block");
    } else if (content.includes("Mi-Core sync")) {
        console.log("⏭️  Mi-Core sync call already present in CONFIRM block");
    } else {
        console.error("❌ Could not find .catch block closing");
    }
} else {
    console.error("❌ Could not find gsheet sync .catch block");
}

if (changes > 0) {
    fs.writeFileSync(file, content, "utf8");
    console.log(`\n📝 Patched ${file} (${changes} change(s))`);
} else {
    console.log("\nNo changes needed.");
}
