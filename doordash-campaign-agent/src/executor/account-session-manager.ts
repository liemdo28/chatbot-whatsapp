/**
 * Account Session Manager
 * Manages Playwright browser sessions for multiple DoorDash store accounts.
 * Each store gets its own persistent browser context.
 */
import { Browser, BrowserContext, chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { getDb } from '../server/db/init.js';

const SESSIONS_DIR = process.env['SESSIONS_DIR'] || './data/sessions';
const SCREENSHOTS_DIR = process.env['SCREENSHOTS_DIR'] || './data/screenshots';

export interface SessionInfo {
    storeId: string;
    storeName: string;
    sessionPath: string;
    sessionStatus: 'none' | 'active' | 'expired' | 'logged_out';
    lastLoginAt: string | null;
    lastLogoutAt: string | null;
    twoFaStatus: 'none' | 'pending' | 'completed';
    browserConnected: boolean;
}

interface ActiveSession {
    storeId: string;
    browser: Browser;
    context: BrowserContext;
    connectedAt: number;
}

const activeSessions = new Map<string, ActiveSession>();

/**
 * Ensure session directory exists for a store.
 */
function ensureSessionDir(storeId: string): string {
    const sessionDir = path.resolve(SESSIONS_DIR, storeId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    return sessionDir;
}

/**
 * Get all stores from the database.
 */
function getAllStores(): Array<{ id: string; name: string; email: string }> {
    const db = getDb();
    return db.prepare('SELECT id, name, email FROM stores WHERE active = 1').all() as any[];
}

/**
 * Get session info for a specific store from DB.
 */
function getPersistedSessionInfo(storeId: string): SessionInfo | null {
    const db = getDb();
    const store = db.prepare('SELECT id, name, email FROM stores WHERE id = ?').get(storeId) as any;
    if (!store) return null;

    const session = db.prepare('SELECT * FROM sessions WHERE store_id = ?').get(storeId) as any;
    const isBrowserConnected = activeSessions.has(storeId);

    return {
        storeId: store.id,
        storeName: store.name,
        sessionPath: session?.session_path || path.resolve(SESSIONS_DIR, storeId),
        sessionStatus: session?.session_status || 'none',
        lastLoginAt: session?.last_login_at || null,
        lastLogoutAt: session?.last_logout_at || null,
        twoFaStatus: session?.two_fa_status || 'none',
        browserConnected: isBrowserConnected,
    };
}

/**
 * Open a persistent browser context for a store account.
 * Uses Playwright's persistent context to save session cookies/localStorage.
 */
export async function openBrowserSession(storeId: string): Promise<{ context: BrowserContext; browser: Browser }> {
    const sessionDir = ensureSessionDir(storeId);
    const userDataDir = path.join(sessionDir, 'playwright-data');
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }

    // If session already exists, return it
    if (activeSessions.has(storeId)) {
        const existing = activeSessions.get(storeId)!;
        return { context: existing.context, browser: existing.browser };
    }

    // Launch persistent context (preserves cookies/localStorage across restarts)
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        locale: 'en-US',
        timezoneId: 'America/Chicago',
        permissions: ['clipboard-read', 'clipboard-write'],
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-dev-shm-usage',
        ],
    });

    const browser = context.browser()!;
    const activeSession: ActiveSession = {
        storeId,
        browser,
        context,
        connectedAt: Date.now(),
    };
    activeSessions.set(storeId, activeSession);

    // Opening a browser profile is not proof that DoorDash is logged in.
    // Login/test flows mark the session active only after they verify the portal.
    const db = getDb();
    const sessionRow = db.prepare('SELECT id FROM sessions WHERE store_id = ?').get(storeId) as any;
    if (sessionRow) {
        db.prepare('UPDATE sessions SET updated_at = datetime(\'now\') WHERE store_id = ?')
            .run(storeId);
    }

    return { context, browser };
}

/**
 * Get or open one page per store for browser interaction.
 */
export async function getPage(storeId: string): Promise<import('playwright').Page> {
    const { context } = await openBrowserSession(storeId);
    const pages = context.pages();
    if (pages.length > 0) {
        return pages[0];
    }
    return await context.newPage();
}

/**
 * Close browser session for a store and save state.
 */
export async function closeBrowserSession(storeId: string): Promise<void> {
    const session = activeSessions.get(storeId);
    if (!session) return;

    try {
        await session.context.close();
    } catch (err) {
        console.error(`[SessionManager] Error closing context for ${storeId}:`, err);
    }
    try {
        await session.browser.close();
    } catch (err) {
        console.error(`[SessionManager] Error closing browser for ${storeId}:`, err);
    }

    activeSessions.delete(storeId);

    const db = getDb();
    const sessionRow = db.prepare('SELECT id FROM sessions WHERE store_id = ?').get(storeId) as any;
    if (sessionRow) {
        db.prepare('UPDATE sessions SET updated_at = datetime(\'now\') WHERE store_id = ?')
            .run(storeId);
    }
}

/**
 * Close all active browser sessions (on app shutdown).
 */
export async function closeAllSessions(): Promise<void> {
    const storeIds = Array.from(activeSessions.keys());
    for (const storeId of storeIds) {
        await closeBrowserSession(storeId);
    }
}

/**
 * Get session status for all stores.
 */
export function getAllSessionStatuses(): SessionInfo[] {
    const stores = getAllStores();
    return stores.map(s => getPersistedSessionInfo(s.id)).filter(Boolean) as SessionInfo[];
}

/**
 * Get session status for one store.
 */
export function getSessionStatus(storeId: string): SessionInfo | null {
    return getPersistedSessionInfo(storeId);
}

/**
 * Check if a saved session exists (browser profile data persisted on disk).
 */
export function hasPersistedSession(storeId: string): boolean {
    const sessionDir = path.resolve(SESSIONS_DIR, storeId, 'playwright-data');
    return fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0;
}

/**
 * Clear persisted session data for a store.
 */
export function clearPersistedSession(storeId: string): void {
    const sessionDir = path.resolve(SESSIONS_DIR, storeId, 'playwright-data');
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    // Also close if active
    if (activeSessions.has(storeId)) {
        closeBrowserSession(storeId).catch(() => { });
    }
    const db = getDb();
    const sessionRow = db.prepare('SELECT id FROM sessions WHERE store_id = ?').get(storeId) as any;
    if (sessionRow) {
        db.prepare('UPDATE sessions SET session_status = ?, two_fa_status = ?, last_login_at = NULL, last_logout_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE store_id = ?')
            .run('none', 'none', storeId);
    }
}

/**
 * Update session after successful login.
 */
export function markLoginSuccess(storeId: string): void {
    const db = getDb();
    const sessionRow = db.prepare('SELECT id FROM sessions WHERE store_id = ?').get(storeId) as any;
    if (sessionRow) {
        db.prepare('UPDATE sessions SET session_status = ?, last_login_at = datetime(\'now\'), two_fa_status = ?, updated_at = datetime(\'now\') WHERE store_id = ?')
            .run('active', 'completed', storeId);
    }
    // Update credential verified status
    db.prepare('UPDATE credentials SET last_verified_at = datetime(\'now\'), credential_status = ? WHERE store_id = ?')
        .run('verified', storeId);
}

/**
 * Check if a browser session can be reused (session file exists and not expired).
 */
export function canReuseSession(storeId: string): boolean {
    const sessionDir = path.resolve(SESSIONS_DIR, storeId, 'playwright-data');
    if (!fs.existsSync(sessionDir)) return false;

    // Check if there are cookie/storage files
    const files = fs.readdirSync(sessionDir);
    if (files.length === 0) return false;

    // Check DB status
    const db = getDb();
    const row = db.prepare('SELECT session_status FROM sessions WHERE store_id = ?').get(storeId) as any;
    return row?.session_status === 'active';
}

/**
 * Take screenshot for audit
 */
export async function takeScreenshot(storeId: string, label: string): Promise<string> {
    const screenshotDir = path.resolve(SCREENSHOTS_DIR, storeId);
    if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${label}-${timestamp}.png`;
    const filepath = path.join(screenshotDir, filename);

    try {
        const page = await getPage(storeId);
        await page.screenshot({ path: filepath, fullPage: true });
        return filepath;
    } catch (err) {
        console.error(`[Screenshot] Failed for ${storeId}:`, err);
        return '';
    }
}

/**
 * Mark a persisted DoorDash session as expired after a real portal check fails.
 */
export function markSessionExpired(storeId: string, twoFaStatus: 'none' | 'pending' | 'completed' = 'none'): void {
    const db = getDb();
    const sessionRow = db.prepare('SELECT id FROM sessions WHERE store_id = ?').get(storeId) as any;
    if (sessionRow) {
        db.prepare('UPDATE sessions SET session_status = ?, two_fa_status = ?, updated_at = datetime(\'now\') WHERE store_id = ?')
            .run('expired', twoFaStatus, storeId);
    }
}
