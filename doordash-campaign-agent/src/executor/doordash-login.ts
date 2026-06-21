/**
 * DoorDash Login
 * Opens DoorDash Merchant Portal login page, allows CEO to complete login manually,
 * handles 2FA if needed, and saves persistent session.
 */
import { Page } from 'playwright';
import { openBrowserSession, getPage, markLoginSuccess, canReuseSession, takeScreenshot } from './account-session-manager.js';
import { getDb } from '../server/db/init.js';
import { decryptPassword, deserializeEncrypted, isCredentialSet } from '../security/encryption.js';

const DOORDASH_LOGIN_URL = 'https://merchant.doordash.com';
const DOORDASH_HOME_URL = 'https://merchant.doordash.com/home';

export interface LoginResult {
    success: boolean;
    message: string;
    storeId: string;
    detectedAsLoggedIn: boolean;
    twoFaRequired: boolean;
    screenshotPath?: string;
}

export interface LoginStatus {
    storeId: string;
    storeName: string;
    isLoggedIn: boolean;
    sessionExists: boolean;
    lastLoginAt: string | null;
    twoFaStatus: string;
    credentialSet: boolean;
}

/**
 * Get login status for a store
 */
export function getLoginStatus(storeId: string): LoginStatus {
    const db = getDb();
    const store = db.prepare('SELECT id, name, email FROM stores WHERE id = ?').get(storeId) as any;
    if (!store) throw new Error(`Store not found: ${storeId}`);

    const session = db.prepare('SELECT * FROM sessions WHERE store_id = ?').get(storeId) as any;
    const cred = db.prepare('SELECT * FROM credentials WHERE store_id = ?').get(storeId) as any;

    return {
        storeId: store.id,
        storeName: store.name,
        isLoggedIn: session?.session_status === 'active',
        sessionExists: canReuseSession(storeId),
        lastLoginAt: session?.last_login_at || null,
        twoFaStatus: session?.two_fa_status || 'none',
        credentialSet: cred ? isCredentialSet(cred.encrypted_password) : false,
    };
}

/**
 * Open DoorDash login page for a store account.
 * CEO manually completes the login.
 * Detects login success by checking URL after navigation.
 */
export async function loginToDoorDash(storeId: string): Promise<LoginResult> {
    try {
        const page = await getPage(storeId);

        // Navigate to DoorDash Merchant Portal login
        await page.goto(DOORDASH_LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });

        // Take initial screenshot
        const initScreenshot = await takeScreenshot(storeId, `login-init-${storeId}`);

        // ── Auto-fill credentials if available ──────────────────────────────
        const db = getDb();
        const store = db.prepare('SELECT email FROM stores WHERE id = ?').get(storeId) as any;
        const cred = db.prepare('SELECT encrypted_password FROM credentials WHERE store_id = ?').get(storeId) as any;

        if (store?.email && cred?.encrypted_password && isCredentialSet(cred.encrypted_password)) {
            const password = decryptPassword(deserializeEncrypted(cred.encrypted_password));
            const email = store.email;

            console.log(`[DoorDashLogin] Auto-filling credentials for ${storeId} (${email})`);

            // Wait for login form to appear
            await page.waitForSelector('input[type="email"], input[name="email"], input[name="username"]', { timeout: 10000 }).catch(() => null);

            // Fill email
            const emailInput = await page.$('input[type="email"], input[name="email"], input[name="username"]');
            if (emailInput) {
                await emailInput.click();
                await emailInput.fill(email);
                console.log(`[DoorDashLogin] Email filled: ${email}`);
            }

            // Fill password
            await page.waitForSelector('input[type="password"]', { timeout: 5000 }).catch(() => null);
            const passInput = await page.$('input[type="password"]');
            if (passInput) {
                await passInput.click();
                await passInput.fill(password);
                console.log(`[DoorDashLogin] Password filled`);
            }

            // Click sign-in button
            await page.waitForTimeout(500);
            const signInBtn = await page.$('button:has-text("Sign In"), button:has-text("Log In"), button[type="submit"]');
            if (signInBtn) {
                await signInBtn.click();
                console.log(`[DoorDashLogin] Sign-in button clicked`);
            }

            // Wait for navigation after submit
            await page.waitForTimeout(3000);
        } else {
            console.log(`[DoorDashLogin] No stored credentials for ${storeId} — waiting for manual login`);
        }
        // ── End auto-fill ───────────────────────────────────────────────────

        // Wait for login completion (up to 5 minutes)
        let loggedIn = false;
        let twoFaDetected = false;

        // Poll for login completion
        for (let i = 0; i < 300; i++) { // 300 * 1s = 5 min timeout
            const currentUrl = page.url();

            // Check if we reached the home/dashboard page
            if (currentUrl.includes('/home') || currentUrl.includes('/dashboard') || currentUrl.includes('/account')) {
                loggedIn = true;
                break;
            }

            // Check for login page elements (still on login)
            const loginFormVisible = await page.$('input[type="email"], input[name="email"], input[type="password"], button:has-text("Sign In"), button:has-text("Log In")');

            // Check for 2FA page
            const twoFaInput = await page.$('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"], input[name*="token"], input[inputmode="numeric"]');

            if (twoFaInput && !loginFormVisible) {
                twoFaDetected = true;
            }

            // Check for dashboard elements indicating logged in
            const dashboardEl = await page.$('[data-testid="dashboard"], [href*="/campaign"], [href*="/promotion"], a:has-text("Campaign"), a:has-text("Promotions")');
            if (dashboardEl) {
                loggedIn = true;
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (loggedIn) {
            markLoginSuccess(storeId);
            const successScreenshot = await takeScreenshot(storeId, `login-success-${storeId}`);
            return {
                success: true,
                message: 'Login successful. Session saved.',
                storeId,
                detectedAsLoggedIn: true,
                twoFaRequired: twoFaDetected,
                screenshotPath: successScreenshot,
            };
        }

        // If not logged in after 5 min, still save what we have
        const timeoutScreenshot = await takeScreenshot(storeId, `login-timeout-${storeId}`);
        return {
            success: false,
            message: twoFaDetected
                ? '2FA detected. CEO must complete 2FA verification manually in the browser.'
                : 'Login timeout. CEO did not complete login within 5 minutes.',
            storeId,
            detectedAsLoggedIn: false,
            twoFaRequired: twoFaDetected,
            screenshotPath: timeoutScreenshot,
        };
    } catch (error: any) {
        console.error(`[DoorDashLogin] Error for ${storeId}:`, error);
        return {
            success: false,
            message: `Login error: ${error.message}`,
            storeId,
            detectedAsLoggedIn: false,
            twoFaRequired: false,
        };
    }
}

/**
 * Test connection to DoorDash for a store.
 * Opens browser, navigates to portal, checks if session is valid.
 */
export async function testDoorDashConnection(storeId: string): Promise<{ connected: boolean; message: string; details: any }> {
    try {
        const page = await getPage(storeId);
        await page.goto(DOORDASH_HOME_URL, { waitUntil: 'networkidle', timeout: 30000 });

        const currentUrl = page.url();
        const isLoggedIn = currentUrl.includes('/home') || currentUrl.includes('/dashboard');
        const pageTitle = await page.title();

        // Take test screenshot
        const screenshot = await takeScreenshot(storeId, `test-connection-${storeId}`);

        return {
            connected: isLoggedIn,
            message: isLoggedIn ? 'Connected to DoorDash Merchant Portal' : 'Not logged in. Redirected to login page.',
            details: {
                url: currentUrl,
                title: pageTitle,
                screenshotPath: screenshot,
            },
        };
    } catch (error: any) {
        return {
            connected: false,
            message: `Connection test failed: ${error.message}`,
            details: { error: error.message },
        };
    }
}

/**
 * Reuse existing session for login (if session file exists).
 * Returns true if session was restored successfully.
 */
export async function reuseExistingSession(storeId: string): Promise<boolean> {
    if (!canReuseSession(storeId)) return false;

    try {
        const page = await getPage(storeId);
        await page.goto(DOORDASH_HOME_URL, { waitUntil: 'networkidle', timeout: 30000 });

        const currentUrl = page.url();
        const isLoggedIn = currentUrl.includes('/home') || currentUrl.includes('/dashboard');

        if (isLoggedIn) {
            markLoginSuccess(storeId);
            console.log(`[DoorDashLogin] Session reused successfully for ${storeId}`);
            return true;
        }

        return false;
    } catch (error) {
        console.error(`[DoorDashLogin] Session reuse failed for ${storeId}:`, error);
        return false;
    }
}