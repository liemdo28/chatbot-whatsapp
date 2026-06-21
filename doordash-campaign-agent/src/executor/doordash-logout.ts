/**
 * DoorDash Logout
 * Logs out of DoorDash Merchant Portal and clears local session data.
 */
import { closeBrowserSession, clearPersistedSession, getSessionStatus, takeScreenshot } from './account-session-manager.js';
import { getDb } from '../server/db/init.js';

export interface LogoutResult {
    success: boolean;
    message: string;
    storeId: string;
    screenshotPath?: string;
}

/**
 * Log out of DoorDash for a specific store.
 * 1. Navigates to logout URL or clicks logout button
 * 2. Closes browser session
 * 3. Clears local session data (optional)
 */
export async function logoutDoorDash(storeId: string, clearLocalSession: boolean = true): Promise<LogoutResult> {
    const result: LogoutResult = { success: false, message: '', storeId };

    try {
        // Try to navigate to logout first if browser is active
        const status = getSessionStatus(storeId);
        if (status && status.browserConnected) {
            try {
                const { getPage } = await import('./account-session-manager.js');
                const page = await getPage(storeId);

                // Try DoorDash logout URL
                await page.goto('https://merchant.doordash.com/logout', { waitUntil: 'networkidle', timeout: 15000 }).catch(() => { });

                // Take screenshot after logout
                const screenshot = await takeScreenshot(storeId, `logout-${storeId}`);
                result.screenshotPath = screenshot;
            } catch (navError) {
                // Navigate to home and click logout button
                try {
                    const { getPage } = await import('./account-session-manager.js');
                    const page = await getPage(storeId);
                    await page.goto('https://merchant.doordash.com', { waitUntil: 'networkidle', timeout: 15000 }).catch(() => { });

                    // Try clicking avatar/account menu then logout button
                    const logoutBtn = await page.$('button:has-text("Log Out"), a:has-text("Log Out"), [href*="logout"]');
                    if (logoutBtn) {
                        await logoutBtn.click();
                        await page.waitForTimeout(2000);
                    }

                    const screenshot = await takeScreenshot(storeId, `logout-${storeId}`);
                    result.screenshotPath = screenshot;
                } catch (innerError) {
                    // Ignore navigation errors during logout
                }
            }

            // Close browser session (saves state automatically)
            await closeBrowserSession(storeId);
        }

        // Clear persisted session data if requested
        if (clearLocalSession) {
            clearPersistedSession(storeId);
        }

        // Update session status in DB
        const db = getDb();
        db.prepare('UPDATE sessions SET session_status = ?, last_logout_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE store_id = ?')
            .run('logged_out', storeId);

        result.success = true;
        result.message = clearLocalSession
            ? 'Logged out and cleared local session.'
            : 'Logged out. Session data retained.';

        return result;
    } catch (error: any) {
        console.error(`[DoorDashLogout] Error for ${storeId}:`, error);
        result.message = `Logout error: ${error.message}`;
        return result;
    }
}

/**
 * Force clear session without trying to logout via browser.
 * Use when logout is not possible (browser closed, etc.)
 */
export function forceClearSession(storeId: string): LogoutResult {
    try {
        clearPersistedSession(storeId);
        return {
            success: true,
            message: 'Session data cleared locally.',
            storeId,
        };
    } catch (error: any) {
        return {
            success: false,
            message: `Failed to clear session: ${error.message}`,
            storeId,
        };
    }
}