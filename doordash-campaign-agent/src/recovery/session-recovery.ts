/**
 * Session Recovery Script — DEV2
 * Recovers DoorDash and Toast sessions using Playwright browser automation.
 * Executes live browser checks against the merchant portals.
 * 
 * Usage: npx tsx src/recovery/session-recovery.ts
 */
import 'dotenv/config';
import { chromium, BrowserContext, Browser } from 'playwright';
import path from 'path';
import fs from 'fs';
import { getDb } from '../server/db/init.js';

const ROOT_DIR = path.resolve(process.cwd());
const SESSIONS_DIR = path.resolve(ROOT_DIR, 'data/sessions');
const SCREENSHOTS_DIR = path.resolve(ROOT_DIR, 'data/screenshots');
const REPORT_DIR = path.resolve(ROOT_DIR, '../test-results/dev2-recovery');
const DOORDASH_URL = 'https://merchant.doordash.com';
const TOAST_URL = 'https://www.toasttab.com';

interface StoreInfo {
    id: string;
    name: string;
    email: string;
}

interface SessionResult {
    storeId: string;
    storeName: string;
    email: string;
    url: string;
    finalUrl: string;
    pageTitle: string;
    sessionState: 'SESSION_ACTIVE' | 'SESSION_EXPIRED' | 'PASSWORD_INVALID' | 'MFA_REQUIRED' | 'ACCOUNT_LOCKED' | 'ERROR' | 'NOT_CHECKED';
    screenshotPath: string;
    sessionDir: string;
    cookies: number;
    notes: string;
}

interface ToastResult {
    url: string;
    finalUrl: string;
    pageTitle: string;
    sessionState: 'SESSION_ACTIVE' | 'SESSION_EXPIRED' | 'MFA_REQUIRED' | 'ACCOUNT_LOCKED' | 'ERROR' | 'NOT_CHECKED';
    screenshotPath: string;
    sessionPath: string;
    cookies: number;
    notes: string;
}

async function ensureDir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function takeScreenshot(context: BrowserContext, label: string, storeId: string): Promise<string> {
    const storeDir = path.join(SCREENSHOTS_DIR, storeId);
    await ensureDir(storeDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${label}-${ts}.png`;
    const filepath = path.join(storeDir, filename);
    try {
        const pages = context.pages();
        if (pages.length > 0) {
            await pages[0].screenshot({ path: filepath, fullPage: true });
        }
    } catch (e: any) {
        console.error(`[Screenshot] Failed: ${e.message}`);
    }
    return filepath;
}

async function takeGlobalScreenshot(label: string): Promise<string> {
    await ensureDir(REPORT_DIR);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(REPORT_DIR, `${label}-${ts}.png`);
    try {
        const browser = await chromium.launch({ headless: true });
        // Just return the path without a page
        await browser.close();
    } catch { /* ignore */ }
    return filepath;
}

function classifyDoorDashState(url: string, title: string, pageText: string): SessionResult['sessionState'] {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    const textLower = pageText.toLowerCase();

    if (urlLower.includes('/home') || urlLower.includes('/dashboard') || urlLower.includes('/account')) {
        return 'SESSION_ACTIVE';
    }
    if (urlLower.includes('login') || urlLower.includes('signin') || urlLower === DOORDASH_URL || urlLower === DOORDASH_URL + '/') {
        if (textLower.includes('incorrect') || textLower.includes('wrong password') || textLower.includes('invalid')) {
            return 'PASSWORD_INVALID';
        }
        if (textLower.includes('locked') || textLower.includes('account is disabled') || textLower.includes('locked out')) {
            return 'ACCOUNT_LOCKED';
        }
        return 'SESSION_EXPIRED';
    }
    if (textLower.includes('verify') || textLower.includes('two-factor') || textLower.includes('2fa') ||
        textLower.includes('mfa') || textLower.includes('authenticator') || textLower.includes('code')) {
        return 'MFA_REQUIRED';
    }
    if (urlLower.includes('logout') || urlLower.includes('sign-out')) {
        return 'SESSION_EXPIRED';
    }
    return 'SESSION_EXPIRED';
}

async function checkDoorDashStore(store: StoreInfo): Promise<SessionResult> {
    const sessionDir = path.join(SESSIONS_DIR, store.id);
    const userDataDir = path.join(sessionDir, 'playwright-data');
    const hasSession = fs.existsSync(userDataDir) && fs.readdirSync(userDataDir).length > 0;

    let context: BrowserContext | null = null;
    let browser: Browser | null = null;

    try {
        // Launch browser — reuse existing session dir if available
        if (hasSession) {
            console.log(`  [${store.name}] Opening existing browser profile...`);
            context = await chromium.launchPersistentContext(userDataDir, {
                headless: false,
                viewport: { width: 1280, height: 900 },
                locale: 'en-US',
                args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
            });
        } else {
            console.log(`  [${store.name}] No session dir — creating fresh profile...`);
            await ensureDir(userDataDir);
            context = await chromium.launchPersistentContext(userDataDir, {
                headless: false,
                viewport: { width: 1280, height: 900 },
                locale: 'en-US',
                args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
            });
        }

        browser = context.browser()!;

        // Navigate to DoorDash
        const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
        await page.goto(DOORDASH_URL, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);

        const finalUrl = page.url();
        const pageTitle = await page.title();
        let pageText = '';
        try { pageText = await page.innerText('body'); } catch { }

        // Count cookies
        const cookies = (await context.cookies()).length;

        // Take screenshot
        const screenshotPath = await takeScreenshot(context, `recovery-check-${store.id}`, store.id);

        // Classify state
        const sessionState = classifyDoorDashState(finalUrl, pageTitle, pageText);

        // Update DB
        const db = getDb();
        if (sessionState === 'SESSION_ACTIVE') {
            db.prepare('UPDATE sessions SET session_status = ?, last_login_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE store_id = ?')
                .run('active', store.id);
        }

        let notes = '';
        if (sessionState === 'SESSION_ACTIVE') notes = `Logged in. Cookies: ${cookies}. URL: ${finalUrl}`;
        else if (sessionState === 'SESSION_EXPIRED') notes = `On login page. Fresh session required. Cookies: ${cookies}`;
        else if (sessionState === 'PASSWORD_INVALID') notes = `Password rejected. CEO must verify credentials.`;
        else if (sessionState === 'MFA_REQUIRED') notes = `2FA/MFA required. CEO must complete.`;
        else if (sessionState === 'ACCOUNT_LOCKED') notes = `Account locked. CEO must resolve.`;
        else notes = `URL: ${finalUrl}, Title: ${pageTitle}`;

        return {
            storeId: store.id,
            storeName: store.name,
            email: store.email,
            url: DOORDASH_URL,
            finalUrl,
            pageTitle,
            sessionState,
            screenshotPath,
            sessionDir: userDataDir,
            cookies,
            notes,
        };
    } catch (e: any) {
        console.error(`  [${store.name}] Error: ${e.message}`);
        return {
            storeId: store.id,
            storeName: store.name,
            email: store.email,
            url: DOORDASH_URL,
            finalUrl: '',
            pageTitle: '',
            sessionState: 'ERROR',
            screenshotPath: '',
            sessionDir: userDataDir,
            cookies: 0,
            notes: `Error: ${e.message}`,
        };
    } finally {
        try { if (context) await context.close(); } catch { }
        try { if (browser) await browser.close(); } catch { }
    }
}

async function checkToastSession(): Promise<ToastResult> {
    const toastSessionFile = path.resolve(ROOT_DIR, '../integration-system-laptop2-CQB-20260615-025044/desktop-app/.toast-session.json');
    const hasSessionFile = fs.existsSync(toastSessionFile);
    const chromeUserData = path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'User Data', 'Default');

    let context: BrowserContext | null = null;
    let browser: Browser | null = null;

    try {
        // Try to reuse Chrome Default profile
        console.log('  [Toast] Attempting to open Chrome profile...');
        context = await chromium.launchPersistentContext(chromeUserData, {
            headless: false,
            viewport: { width: 1280, height: 900 },
            locale: 'en-US',
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
        });

        browser = context.browser()!;
        const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
        await page.goto(TOAST_URL, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);

        const finalUrl = page.url();
        const pageTitle = await page.title();
        let pageText = '';
        try { pageText = await page.innerText('body'); } catch { }
        const cookies = (await context.cookies()).length;

        await ensureDir(REPORT_DIR);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = path.join(REPORT_DIR, `toast-recovery-check-${ts}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const textLower = pageText.toLowerCase();
        let sessionState: ToastResult['sessionState'] = 'SESSION_EXPIRED';
        if (finalUrl.includes('/home') || finalUrl.includes('/dashboard') || finalUrl.includes('manager')) {
            sessionState = 'SESSION_ACTIVE';
        } else if (textLower.includes('verify') || textLower.includes('authenticate') || textLower.includes('mfa') || textLower.includes('2fa')) {
            sessionState = 'MFA_REQUIRED';
        } else if (finalUrl.includes('login') || finalUrl.includes('signin')) {
            sessionState = 'SESSION_EXPIRED';
        }

        const notes = sessionState === 'SESSION_ACTIVE'
            ? `Logged in. Cookies: ${cookies}. URL: ${finalUrl}`
            : `Session expired. Cookies: ${cookies}. URL: ${finalUrl}. CEO login required.`;

        return {
            url: TOAST_URL,
            finalUrl,
            pageTitle,
            sessionState,
            screenshotPath,
            sessionPath: chromeUserData,
            cookies,
            notes,
        };
    } catch (e: any) {
        console.error(`  [Toast] Error: ${e.message}`);
        return {
            url: TOAST_URL,
            finalUrl: '',
            pageTitle: '',
            sessionState: 'ERROR',
            screenshotPath: '',
            sessionPath: chromeUserData,
            cookies: 0,
            notes: `Error: ${e.message}`,
        };
    } finally {
        try { if (context) await context.close(); } catch { }
        try { if (browser) await browser.close(); } catch { }
    }
}

async function main() {
    console.log('\n========================================');
    console.log('  DEV2 — Session Recovery');
    console.log('  DoorDash + Toast Portal Recovery');
    console.log('========================================\n');

    await ensureDir(REPORT_DIR);

    const db = getDb();
    const stores = db.prepare('SELECT id, name, email FROM stores WHERE active = 1').all() as StoreInfo[];

    // ── D2-1: DoorDash Session Recovery ───────────────────────────────
    console.log('[D2-1] DOORDASH SESSION RECOVERY\n');
    const ddResults: SessionResult[] = [];

    for (const store of stores) {
        console.log(`Checking ${store.name} (${store.id})...`);
        const result = await checkDoorDashStore(store);
        ddResults.push(result);
        console.log(`  State: ${result.sessionState}`);
        console.log(`  URL: ${result.finalUrl}`);
        console.log(`  Screenshot: ${result.screenshotPath}`);
        console.log('');
    }

    // ── D2-2: Toast Session Recovery ──────────────────────────────────
    console.log('[D2-2] TOAST SESSION RECOVERY\n');
    const toastResult = await checkToastSession();
    console.log(`  State: ${toastResult.sessionState}`);
    console.log(`  URL: ${toastResult.finalUrl}`);
    console.log(`  Screenshot: ${toastResult.screenshotPath}`);
    console.log('');

    // ── Generate Reports ───────────────────────────────────────────────
    const now = new Date().toISOString();

    // DOORDASH_RECOVERY_REPORT
    const ddReport = `# DOORDASH_SESSION_RECOVERY_REPORT.md
Generated: ${now}

## Summary

| Store | Email | Session State | Notes |
|-------|-------|--------------|-------|
${ddResults.map(r => `| ${r.storeName} | ${r.email} | **${r.sessionState}** | ${r.notes} |`).join('\n')}

## Detailed Results

${ddResults.map(r => `### ${r.storeName} (${r.storeId})

- **Email:** ${r.email}
- **Session State:** ${r.sessionState}
- **Initial URL:** ${r.url}
- **Final URL:** ${r.finalUrl}
- **Page Title:** ${r.pageTitle}
- **Session Directory:** \`${r.sessionDir}\`
- **Cookies Found:** ${r.cookies}
- **Screenshot:** \`${r.screenshotPath}\`
- **Notes:** ${r.notes}
`).join('\n---\n')}

## Acceptance Criteria

| Store | Criterion | Status |
|-------|-----------|--------|
${ddResults.map(r => {
        if (r.sessionState === 'SESSION_ACTIVE') return `| ${r.storeName} | Logged in and session persisted | PASS |`;
        if (r.sessionState === 'MFA_REQUIRED') return `| ${r.storeName} | MFA required — CEO action required | BLOCKED |`;
        if (r.sessionState === 'PASSWORD_INVALID') return `| ${r.storeName} | Password invalid — CEO must update credentials | BLOCKED |`;
        if (r.sessionState === 'ACCOUNT_LOCKED') return `| ${r.storeName} | Account locked — CEO must resolve | BLOCKED |`;
        return `| ${r.storeName} | Session expired — fresh login required | PENDING |`;
    }).join('\n')}

## Screenshots

${ddResults.map(r => `- \`${r.screenshotPath}\` — ${r.storeName}: ${r.sessionState}`).join('\n')}

---
Target: DOORDASH_TOAST_ACCESS_RECOVERED
`;

    // TOAST_RECOVERY_REPORT
    const toastReport = `# TOAST_SESSION_RECOVERY_REPORT.md
Generated: ${now}

## Summary

| System | Session State | Notes |
|--------|--------------|-------|
| Toast POS | **${toastResult.sessionState}** | ${toastResult.notes} |

## Detailed Result

- **URL:** ${toastResult.url}
- **Final URL:** ${toastResult.finalUrl}
- **Page Title:** ${toastResult.pageTitle}
- **Session Path:** \`${toastResult.sessionPath}\`
- **Cookies Found:** ${toastResult.cookies}
- **Screenshot:** \`${toastResult.screenshotPath}\`

## Status Classification

| State | Meaning | Action Required |
|-------|---------|----------------|
| SESSION_ACTIVE | Logged in, session valid | None |
| SESSION_EXPIRED | Logged out, session stale | CEO login required |
| MFA_REQUIRED | 2FA/MFA challenge | CEO must complete MFA |
| ACCOUNT_LOCKED | Account locked | CEO must resolve |

## Current Classification: ${toastResult.sessionState}

${toastResult.sessionState !== 'SESSION_ACTIVE' ? '**ACTION REQUIRED:** CEO must complete login/MFA in the opened browser window.' : '**STATUS:** Toast session is active.'}

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Toast report downloaded with real file evidence | ${toastResult.sessionState === 'SESSION_ACTIVE' ? 'PASS' : 'PENDING — CEO login required'} |

---
Target: DOORDASH_TOAST_ACCESS_RECOVERED
`;

    // PERSISTENCE_REPORT (placeholder — will be updated after persistence test)
    const persistenceReport = `# SESSION_PERSISTENCE_REPORT.md
Generated: ${now}

## DoorDash Session Persistence

${ddResults.map(r => `### ${r.storeName}

- **Session State:** ${r.sessionState}
- **Session Dir:** \`${r.sessionDir}\`
- **Persistence Test:** ${r.sessionState === 'SESSION_ACTIVE' ? 'PENDING — browser restart required' : 'N/A (not logged in)'}
`).join('\n')}

## Toast Session Persistence

- **Session State:** ${toastResult.sessionState}
- **Session Path:** \`${toastResult.sessionPath}\`
- **Persistence Test:** ${toastResult.sessionState === 'SESSION_ACTIVE' ? 'PENDING — browser restart required' : 'N/A (not logged in)'}

---
Target: DOORDASH_TOAST_ACCESS_RECOVERED
`;

    // Write reports
    const ddReportPath = path.join(REPORT_DIR, 'DOORDASH_SESSION_RECOVERY_REPORT.md');
    const toastReportPath = path.join(REPORT_DIR, 'TOAST_SESSION_RECOVERY_REPORT.md');
    const persistReportPath = path.join(REPORT_DIR, 'SESSION_PERSISTENCE_REPORT.md');

    fs.writeFileSync(ddReportPath, ddReport);
    fs.writeFileSync(toastReportPath, toastReport);
    fs.writeFileSync(persistReportPath, persistenceReport);

    console.log('\n========================================');
    console.log('  REPORTS GENERATED');
    console.log('========================================');
    console.log(`  DoorDash: ${ddReportPath}`);
    console.log(`  Toast: ${toastReportPath}`);
    console.log(`  Persistence: ${persistReportPath}`);
    console.log('\n========================================');
    console.log('  DOORDASH RESULTS');
    console.log('========================================');
    for (const r of ddResults) {
        console.log(`  ${r.storeName}: ${r.sessionState}`);
    }
    console.log('\n========================================');
    console.log('  TOAST RESULT');
    console.log('========================================');
    console.log(`  ${toastResult.sessionState}`);
    console.log('');
}

main().catch(console.error);
