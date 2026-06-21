/**
 * Auto-Fill + Submit DoorDash Login Flow
 * Opens browser, fills credentials, submits, classifies result.
 * Screenshots AFTER submission attempt.
 * NO passwords printed to console.
 */
import "dotenv/config";
import { chromium, BrowserContext } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getDb } from "../server/db/init.js";
import { decryptPassword, deserializeEncrypted, isCredentialSet } from "../security/encryption.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SCREENSHOTS = path.resolve(ROOT, "data/screenshots");
const REPORT_DIR = path.resolve(ROOT, "../test-results/dev2-recovery");

interface LoginAttempt {
    storeId: string;
    storeName: string;
    email: string;
    state: "SUCCESS" | "MFA_REQUIRED" | "CAPTCHA_REQUIRED" | "INVALID_PASSWORD" | "ACCOUNT_LOCKED" | "UNKNOWN_ERROR" | "NOT_ATTEMPTED";
    finalUrl: string;
    pageTitle: string;
    screenshotPath: string;
    cookies: number;
    error?: string;
}

async function ensureDir(d: string) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

async function screenshot(context: BrowserContext, label: string, storeId: string): Promise<string> {
    const storeDir = path.join(SCREENSHOTS, storeId);
    await ensureDir(storeDir);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const fp = path.join(storeDir, `${label}-${storeId}-${ts}.png`);
    try {
        const pages = context.pages();
        if (pages.length > 0) await pages[0].screenshot({ path: fp, fullPage: true });
    } catch { }
    return fp;
}

async function attemptStoreLogin(storeId: string, storeName: string, email: string): Promise<LoginAttempt> {
    const sessionDir = path.join(ROOT, "data/sessions", storeId);
    const userData = path.join(sessionDir, "playwright-data");

    await ensureDir(userData);

    let context: BrowserContext | null = null;
    let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext> | null = null;

    try {
        // Launch browser
        context = await chromium.launchPersistentContext(userData, {
            headless: false,
            viewport: { width: 1280, height: 900 },
            locale: "en-US",
            args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
        });

        browser = context.browser();
        const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

        // Navigate to login
        await page.goto("https://merchant.doordash.com", { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(2000);

        // Take pre-login screenshot
        const preScreenshot = await screenshot(context, "dd-pre-login", storeId);

        // Get password from DB
        const db = getDb();
        const credRow = db.prepare("SELECT encrypted_password FROM credentials WHERE store_id = ?").get(storeId) as any;
        const password = (() => {
            try {
                if (credRow?.encrypted_password && isCredentialSet(credRow.encrypted_password)) {
                    return decryptPassword(deserializeEncrypted(credRow.encrypted_password));
                }
                return null;
            } catch { return null; }
        })();

        let fillState = "CREDENTIALS_FOUND";
        if (!password) fillState = "NO_CREDENTIALS";

        // Fill credentials if available
        if (password) {
            // Email field
            const emailSel = 'input[type="email"], input[name="emai