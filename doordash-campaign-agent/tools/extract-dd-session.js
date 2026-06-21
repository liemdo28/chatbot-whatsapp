/**
 * extract-dd-session.js — DoorDash Cookie + Token Extractor
 *
 * Extracts cookies, localStorage tokens, and session state from
 * an existing Playwright browser session for a DoorDash store.
 *
 * Usage:
 *   node tools/extract-dd-session.js bakudan-stone-oak
 *   node tools/extract-dd-session.js bakudan-stone-oak --save
 *   node tools/extract-dd-session.js bakudan-stone-oak --refresh
 *
 * Flags:
 *   --save      Save extracted tokens to data/sessions/{store}/extracted.json
 *   --refresh   Re-login if session expired, then extract
 *   --all       Extract from all stores
 */

const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const SESSIONS_DIR = path.join(ROOT, "data", "sessions");

// ─── Session Extraction ───────────────────────────────────────────────

async function extractSession(storeId, opts = {}) {
    const sessionDir = path.join(SESSIONS_DIR, storeId);
    const userDataDir = path.join(sessionDir, "playwright-data");

    console.log(`\n=== Extracting session for ${storeId} ===`);

    // Check if session exists
    if (!fs.existsSync(userDataDir) || fs.readdirSync(userDataDir).length === 0) {
        console.log("  ⚠️  No session data found at", userDataDir);
        console.log("  Need to login first. Run: node tools/extract-dd-session.js " + storeId + " --refresh");
        return null;
    }

    let chromium;
    try {
        chromium = require("playwright").chromium;
    } catch {
        try {
            chromium = require("playwright-core").chromium;
        } catch {
            console.error("  ❌ Playwright not found. Install: npm install playwright-core");
            return null;
        }
    }

    let context;
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: true,
            args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        });
    } catch (err) {
        console.error("  ❌ Failed to launch browser:", err.message);
        return null;
    }

    try {
        const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

        // Navigate to DoorDash merchant portal
        await page.goto("https://merchant.doordash.com", { waitUntil: "networkidle", timeout: 30000 }).catch(() => { });
        await page.waitForTimeout(3000);

        const finalUrl = page.url();
        const title = await page.title();
        const isLoggedIn = !finalUrl.includes("login") && !finalUrl.includes("signin");

        console.log("  URL:", finalUrl);
        console.log("  Title:", title);
        console.log("  Logged in:", isLoggedIn);

        // Extract cookies
        const allCookies = await context.cookies();
        const ddCookies = allCookies.filter(c =>
            c.domain.includes("doordash.com") || c.domain.includes(".doordash.")
        );

        console.log("  Total cookies:", allCookies.length);
        console.log("  DoorDash cookies:", ddCookies.length);

        // Extract important cookies
        const important = {};
        for (const c of ddCookies) {
            if (["sessionid", "csrf_token", "sid", "dd_session", "dd_user", "session", "token", "auth", "jwt"].some(k =>
                c.name.toLowerCase().includes(k)
            )) {
                important[c.name] = {
                    value: c.value.substring(0, 20) + "...",
                    domain: c.domain,
                    path: c.path,
                    expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : "session",
                    httpOnly: c.httpOnly,
                    secure: c.secure,
                };
            }
        }

        // Extract localStorage tokens
        const localStorage = await page.evaluate(() => {
            const items = {};
            try {
                for (let i = 0; i < window.localStorage.length; i++) {
                    const key = window.localStorage.key(i);
                    const val = window.localStorage.getItem(key);
                    // Only save short-ish values that look like tokens
                    if (val && val.length < 2000) {
                        items[key] = val;
                    }
                }
            } catch { }
            return items;
        });

        // Extract sessionStorage tokens
        const sessionStorage = await page.evaluate(() => {
            const items = {};
            try {
                for (let i = 0; i < window.sessionStorage.length; i++) {
                    const key = window.sessionStorage.key(i);
                    const val = window.sessionStorage.getItem(key);
                    if (val && val.length < 2000) {
                        items[key] = val;
                    }
                }
            } catch { }
            return items;
        });

        // Find auth tokens in localStorage
        const authTokens = {};
        for (const [key, val] of Object.entries(localStorage)) {
            if (key.toLowerCase().includes("token") || key.toLowerCase().includes("auth") ||
                key.toLowerCase().includes("session") || key.toLowerCase().includes("user")) {
                authTokens[key] = val.substring(0, 100) + (val.length > 100 ? "..." : "");
            }
        }

        // Build extraction result
        const result = {
            storeId,
            extractedAt: new Date().toISOString(),
            isLoggedIn,
            finalUrl,
            pageTitle: title,
            cookies: {
                total: ddCookies.length,
                important: Object.keys(important).length,
                details: ddCookies.map(c => ({
                    name: c.name,
                    value: c.value.substring(0, 50) + (c.value.length > 50 ? "..." : ""),
                    domain: c.domain,
                    expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : "session",
                    httpOnly: c.httpOnly,
                    secure: c.secure,
                })),
                important,
            },
            localStorage: {
                total: Object.keys(localStorage).length,
                items: localStorage,
            },
            sessionStorage: {
                total: Object.keys(sessionStorage).length,
                items: sessionStorage,
            },
            authTokens,
            // Full cookie headers (for API use)
            cookieHeader: ddCookies.map(c => c.name + "=" + c.value).join("; "),
        };

        // Print summary
        console.log("\n  --- Cookie Summary ---");
        for (const [name, info] of Object.entries(important)) {
            console.log("    " + name + ": " + info.value + " (" + info.domain + ", expires: " + info.expires + ")");
        }

        console.log("\n  --- Auth Tokens ---");
        for (const [key, val] of Object.entries(authTokens)) {
            console.log("    " + key + ": " + val);
        }

        console.log("\n  --- Cookie Header (for API calls) ---");
        console.log("    Length:", result.cookieHeader.length, "chars");
        console.log("    Preview:", result.cookieHeader.substring(0, 100) + "...");

        // Save if requested
        if (opts.save) {
            const outPath = path.join(sessionDir, "extracted.json");
            fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
            console.log("\n  ✅ Saved to:", outPath);
        }

        // Also save just the cookie header for quick API use
        if (opts.save) {
            const cookiePath = path.join(sessionDir, "cookie-header.txt");
            fs.writeFileSync(cookiePath, result.cookieHeader);
            console.log("  ✅ Cookie header saved to:", cookiePath);
        }

        return result;
    } finally {
        await context.close().catch(() => { });
    }
}

// ─── All Stores ───────────────────────────────────────────────────────

async function extractAll(opts) {
    const dbPath = path.join(ROOT, "data", "doordash-campaigns.db");
    if (!fs.existsSync(dbPath)) {
        console.error("Database not found:", dbPath);
        return;
    }

    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    const stores = db.prepare("SELECT id, name, email FROM stores").all();
    db.close();

    const results = [];
    for (const store of stores) {
        const result = await extractSession(store.id, opts);
        results.push({ store: store.name, result });
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("EXTRACTION SUMMARY");
    console.log("=".repeat(50));
    for (const { store, result } of results) {
        if (result) {
            console.log(`  ${store}: ${result.isLoggedIn ? "LOGGED IN" : "NOT LOGGED IN"} | Cookies: ${result.cookies.total} | Auth tokens: ${Object.keys(result.authTokens).length}`);
        } else {
            console.log(`  ${store}: NO SESSION`);
        }
    }
}

// ─── CLI ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const save = args.includes("--save");
const refresh = args.includes("--refresh");
const all = args.includes("--all");
const storeId = args.find(a => !a.startsWith("--"));

async function main() {
    if (all) {
        await extractAll({ save });
    } else if (storeId) {
        await extractSession(storeId, { save });
    } else {
        console.log("Usage: node tools/extract-dd-session.js <store-id> [--save]");
        console.log("       node tools/extract-dd-session.js --all [--save]");
        console.log();
        console.log("Store IDs: bakudan-the-rim, bakudan-stone-oak, bakudan-bandera, raw-sushi-bar");
    }
}

main().catch(console.error);
