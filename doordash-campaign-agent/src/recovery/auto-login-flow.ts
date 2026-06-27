/**
 * Auto-fill DoorDash login flow for session recovery.
 *
 * This utility is intentionally conservative:
 * - never prints passwords
 * - saves screenshots after each attempt
 * - classifies MFA/captcha/invalid-password states for operator handoff
 */
import 'dotenv/config';
import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { getDb } from '../server/db/init.js';
import { decryptPassword, deserializeEncrypted, isCredentialSet } from '../security/encryption.js';

const ROOT = path.resolve(process.cwd());
const SCREENSHOTS = path.resolve(ROOT, 'data/screenshots');
const REPORT_DIR = path.resolve(ROOT, '../test-results/dev2-recovery');
const DOORDASH_URL = 'https://merchant.doordash.com';

type LoginState =
    | 'SUCCESS'
    | 'MFA_REQUIRED'
    | 'CAPTCHA_REQUIRED'
    | 'INVALID_PASSWORD'
    | 'ACCOUNT_LOCKED'
    | 'NO_CREDENTIALS'
    | 'UNKNOWN_ERROR';

interface LoginAttempt {
    storeId: string;
    storeName: string;
    email: string;
    state: LoginState;
    finalUrl: string;
    pageTitle: string;
    screenshotPath: string;
    cookies: number;
    error?: string;
}

async function ensureDir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function screenshot(context: BrowserContext, label: string, storeId: string): Promise<string> {
    const storeDir = path.join(SCREENSHOTS, storeId);
    await ensureDir(storeDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(storeDir, `${label}-${storeId}-${timestamp}.png`);

    try {
        const page = context.pages()[0];
        if (page) await page.screenshot({ path: filepath, fullPage: true });
    } catch {
        // Best effort only; the caller still gets the intended path for audit.
    }

    return filepath;
}

function getStoredPassword(storeId: string): string | null {
    try {
        const db = getDb();
        const row = db.prepare('SELECT encrypted_password FROM credentials WHERE store_id = ?').get(storeId) as any;
        if (!row?.encrypted_password || !isCredentialSet(row.encrypted_password)) return null;
        return decryptPassword(deserializeEncrypted(row.encrypted_password));
    } catch {
        return null;
    }
}

async function fillFirst(page: Page, selectors: string, value: string): Promise<boolean> {
    const input = await page.$(selectors).catch(() => null);
    if (!input) return false;
    await input.click();
    await input.fill(value);
    return true;
}

async function clickFirst(page: Page, selectors: string): Promise<boolean> {
    const button = await page.$(selectors).catch(() => null);
    if (!button) return false;
    await button.click();
    return true;
}

async function classifyLoginState(page: Page): Promise<LoginState> {
    const url = page.url().toLowerCase();
    const title = (await page.title().catch(() => '')).toLowerCase();
    const body = (await page.innerText('body').catch(() => '')).toLowerCase();

    if (
        url.includes('/home') ||
        url.includes('/dashboard') ||
        url.includes('/business') ||
        body.includes('campaign') ||
        body.includes('promotions')
    ) {
        return 'SUCCESS';
    }

    if (
        body.includes('verification code') ||
        body.includes('two-factor') ||
        body.includes('two factor') ||
        body.includes('multi-factor') ||
        body.includes('one-time code') ||
        (await page.$('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]').catch(() => null))
    ) {
        return 'MFA_REQUIRED';
    }

    if (body.includes('captcha') || title.includes('captcha')) return 'CAPTCHA_REQUIRED';
    if (body.includes('incorrect password') || body.includes('invalid password') || body.includes('invalid email')) return 'INVALID_PASSWORD';
    if (body.includes('locked') || body.includes('too many attempts')) return 'ACCOUNT_LOCKED';

    return 'UNKNOWN_ERROR';
}

async function attemptStoreLogin(storeId: string, storeName: string, email: string): Promise<LoginAttempt> {
    const userDataDir = path.join(ROOT, 'data/sessions', storeId, 'playwright-data');
    await ensureDir(userDataDir);

    let context: BrowserContext | null = null;

    try {
        const password = getStoredPassword(storeId);
        if (!password) {
            return {
                storeId,
                storeName,
                email,
                state: 'NO_CREDENTIALS',
                finalUrl: '',
                pageTitle: '',
                screenshotPath: '',
                cookies: 0,
            };
        }

        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            viewport: { width: 1280, height: 900 },
            locale: 'en-US',
            timezoneId: 'America/Chicago',
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
        });

        const page = context.pages()[0] || await context.newPage();
        await page.goto(DOORDASH_URL, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1500);

        await fillFirst(page, 'input[type="email"], input[name="email"], input[name="username"]', email);
        await fillFirst(page, 'input[type="password"], input[name="password"]', password);
        await clickFirst(page, 'button:has-text("Sign In"), button:has-text("Log In"), button[type="submit"]');

        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
        await page.waitForTimeout(3000);

        const state = await classifyLoginState(page);
        const screenshotPath = await screenshot(context, `dd-login-${state.toLowerCase()}`, storeId);
        const cookies = (await context.cookies()).filter(cookie => cookie.domain.includes('doordash')).length;

        if (state === 'SUCCESS') {
            getDb()
                .prepare('UPDATE sessions SET session_status = ?, last_login_at = datetime(\'now\'), two_fa_status = ?, updated_at = datetime(\'now\') WHERE store_id = ?')
                .run('active', 'completed', storeId);
        }

        return {
            storeId,
            storeName,
            email,
            state,
            finalUrl: page.url(),
            pageTitle: await page.title().catch(() => ''),
            screenshotPath,
            cookies,
        };
    } catch (error: any) {
        const screenshotPath = context ? await screenshot(context, 'dd-login-error', storeId) : '';
        return {
            storeId,
            storeName,
            email,
            state: 'UNKNOWN_ERROR',
            finalUrl: '',
            pageTitle: '',
            screenshotPath,
            cookies: 0,
            error: error.message,
        };
    } finally {
        await context?.close().catch(() => undefined);
    }
}

export async function runAutoLoginFlow(): Promise<LoginAttempt[]> {
    await ensureDir(REPORT_DIR);

    const db = getDb();
    const stores = db.prepare('SELECT id, name, email FROM stores WHERE active = 1 ORDER BY name').all() as any[];
    const results: LoginAttempt[] = [];

    for (const store of stores) {
        results.push(await attemptStoreLogin(store.id, store.name, store.email));
    }

    const reportPath = path.join(REPORT_DIR, `doordash-auto-login-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
    console.log(`[AutoLogin] Report written: ${reportPath}`);

    return results;
}

if (require.main === module) {
    runAutoLoginFlow()
        .then(results => {
            for (const result of results) {
                console.log(`${result.storeName}: ${result.state} (${result.finalUrl || 'no-url'})`);
            }
        })
        .catch(error => {
            console.error('[AutoLogin] Failed:', error);
            process.exitCode = 1;
        });
}
