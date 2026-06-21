/**
 * run_auto_login.mjs
 * Automated login execution for DoorDash + Toast + Google OAuth check.
 * Usage: node run_auto_login.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url);
const REPORT_DIR = join(__dirname, "test-results", "live-op");
const DD_API = "http://127.0.0.1:3001";

mkdirSync(REPORT_DIR, { recursive: true });

function curl(url, method = "GET", body = null, timeoutSec = 310) {
    try {
        const args = ["curl", "-s", "-X", method, url];
        if (body) {
            args.push("-H", "Content-Type: application/json");
            args.push("-d", JSON.stringify(body));
        }
        const out = execSync(args.join(" "), { timeout: timeoutSec * 1000, encoding: "utf-8", windowsHide: true });
        return JSON.parse(out || "{}");
    } catch (e) {
        const stdout = e.stdout || "";
        try { return JSON.parse(stdout); } catch { return { raw: stdout.substring(0, 500), error: e.message }; }
    }
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ── DoorDash Auto-Login ──────────────────────────────────────────────
const stores = ["bakudan-the-rim", "bakudan-stone-oak", "bakudan-bandera", "raw-sushi-bar"];
const ddResults = {};

console.log("\n=== DOORDASH AUTO LOGIN ===\n");
for (const store of stores) {
    console.log(`Triggering login for ${store}...`);
    const r = curl(`${DD_API}/api/login/${store}`, "POST", null, 310);
    const success = r.success || false;
    const twoFa = r.twoFaRequired || false;
    const msg = (r.message || "no message").substring(0, 120);
    const screenshot = r.screenshotPath || "";
    console.log(`  success=${success} twoFa=${twoFa} msg=${msg}`);
    if (screenshot) console.log(`  screenshot=${screenshot}`);
    ddResults[store] = { success, twoFaRequired: twoFa, message: msg, screenshotPath: screenshot };
    await sleep(3000);
}

// ── Toast Login ─────────────────────────────────────────────────────
console.log("\n=== TOAST LOGIN ===\n");
// Toast API endpoint — try the integration system
try {
    const toastR = curl("http://127.0.0.1:8000/api/reviews/sources/toast/login", "POST", null, 60);
    console.log("Toast result:", JSON.stringify(toastR).substring(0, 200));
} catch (e) {
    console.log("Toast login endpoint not found on review system.");
}

// ── Google OAuth Token Check ────────────────────────────────────────
console.log("\n=== GOOGLE TOKEN CHECK ===\n");
const tokenFile = "C:/Users/hoang/Downloads/google token/Request Response.txt";
let hasBusinessManage = false;
let tokenContent = "";
if (existsSync(tokenFile)) {
    tokenContent = readFileSync(tokenFile, "utf-8");
    hasBusinessManage = tokenContent.includes("business.manage");
    console.log(`Token file found: ${tokenFile}`);
    console.log(`Has business.manage scope: ${hasBusinessManage}`);
    console.log(`Scope present: ${tokenContent.includes("scope") ? tokenContent.match(/scope[^\n]*/)?.[0] : "not found"}`);
} else {
    console.log("Token file not found.");
}

// ── Save results ───────────────────────────────────────────────────
const results = {
    timestamp: new Date().toISOString(),
    doordash: ddResults,
    googleBusinessScope: hasBusinessManage,
    tokenFile,
    tokenScope: tokenContent.match(/scope[^\n]*/)?.[0] || "N/A",
};

writeFileSync(join(REPORT_DIR, "auto_login_results.json"), JSON.stringify(results, null, 2));

console.log("\n=== SUMMARY ===");
for (const [store, r] of Object.entries(ddResults)) {
    console.log(`  ${store}: success=${r.success} twoFa=${r.twoFaRequired}`);
}
console.log(`  Google business.manage scope: ${hasBusinessManage}`);
console.log(`\nResults saved to: ${join(REPORT_DIR, "auto_login_results.json")}`);