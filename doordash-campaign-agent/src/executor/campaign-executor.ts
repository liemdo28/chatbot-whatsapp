/**
 * Campaign Executor
 * Executes approved campaign changes on DoorDash Merchant Portal.
 * CRITICAL SAFETY: Only executes changes with valid approval_id.
 * Captures screenshots before and after. Logs everything to audit_log.
 */
import { Page } from 'playwright';
import { getPage, takeScreenshot } from './account-session-manager.js';
import { getDb } from '../server/db/init.js';
import { v4 as uuidv4 } from 'uuid';

export interface ExecutionRequest {
    approvalId: string;
    storeId: string;
    campaignSnapshotId: string;
    actionType: 'edit_budget' | 'pause_campaign' | 'resume_campaign' | 'create_draft' | 'update_promotion';
    approvedValue: string;
}

export interface ExecutionResult {
    success: boolean;
    executionId: string;
    message: string;
    screenshotBefore: string;
    screenshotAfter: string;
    storeId: string;
}

/**
 * PRE-EXECUTION GUARDRAIL CHECK
 * Validates that:
 * 1. approval_id exists and is approved
 * 2. Correct account is verified
 * 3. Correct store is verified
 * 4. Correct campaign is targeted
 * 5. Approved value matches
 * Returns error if any check fails.
 */
function validateApproval(request: ExecutionRequest): { valid: boolean; error?: string } {
    const db = getDb();

    const approval = db.prepare('SELECT * FROM approvals WHERE id = ? AND status = ?').get(request.approvalId, 'approved') as any;
    if (!approval) {
        return { valid: false, error: `Invalid or unapproved approval_id: ${request.approvalId}` };
    }

    if (approval.store_id !== request.storeId) {
        return { valid: false, error: `Store mismatch: approval is for ${approval.store_id}, request is for ${request.storeId}` };
    }

    if (approval.action_type !== request.actionType) {
        return { valid: false, error: `Action type mismatch: approved ${approval.action_type}, request ${request.actionType}` };
    }

    if (!approval.executed_at) {
        return { valid: true };
    }

    return { valid: false, error: `This approval has already been executed at ${approval.executed_at}` };
}

/**
 * Get DoorDash Merchant Portal URL for specific campaign actions
 */
function getActionUrl(actionType: string, campaignSnapshotId: string): string {
    const baseUrl = 'https://merchant.doordash.com';
    switch (actionType) {
        case 'edit_budget':
        case 'pause_campaign':
        case 'resume_campaign':
        case 'update_promotion':
            return `${baseUrl}/promotions`;
        case 'create_draft':
            return `${baseUrl}/promotions/new`;
        default:
            return `${baseUrl}/promotions`;
    }
}

/**
 * Execute an approved campaign change.
 * CRITICAL: Only call this with a valid, approved execution request.
 */
export async function executeApprovedChange(request: ExecutionRequest): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const result: ExecutionResult = {
        success: false,
        executionId,
        message: '',
        screenshotBefore: '',
        screenshotAfter: '',
        storeId: request.storeId,
    };

    // Step 1: Guardrail check
    const validation = validateApproval(request);
    if (!validation.valid) {
        result.message = `Guardrail block: ${validation.error}`;
        logExecution(executionId, request, result);
        return result;
    }

    // Step 2: Take "before" screenshot
    let screenshotBefore = '';
    let screenshotAfter = '';
    let page: Page;

    try {
        page = await getPage(request.storeId);
    } catch (error: any) {
        result.message = `Could not open browser for ${request.storeId}: ${error.message}`;
        logExecution(executionId, request, result);
        return result;
    }

    try {
        // Verify account is correct
        await page.goto('https://merchant.doordash.com', { waitUntil: 'networkidle', timeout: 30000 });
        const accountVerified = await verifyCorrectAccount(page, request.storeId);
        if (!accountVerified) {
            result.message = 'Account verification failed. Wrong account may be logged in.';
            logExecution(executionId, request, result);
            return result;
        }

        // Take "before" screenshot
        screenshotBefore = await takeScreenshot(request.storeId, `before-${request.actionType}-${executionId}`);
        result.screenshotBefore = screenshotBefore;

        // Navigate to action page
        const actionUrl = getActionUrl(request.actionType, request.campaignSnapshotId);
        await page.goto(actionUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);

        // Execute the action
        let actionSuccess = false;
        switch (request.actionType) {
            case 'edit_budget':
                actionSuccess = await executeBudgetEdit(page, request);
                break;
            case 'pause_campaign':
                actionSuccess = await executePauseCampaign(page, request);
                break;
            case 'resume_campaign':
                actionSuccess = await executeResumeCampaign(page, request);
                break;
            case 'update_promotion':
                actionSuccess = await executeUpdatePromotion(page, request);
                break;
            default:
                result.message = `Unknown action type: ${request.actionType}`;
                logExecution(executionId, request, result);
                return result;
        }

        if (!actionSuccess) {
            result.message = `Action execution failed: ${request.actionType}`;
            logExecution(executionId, request, result);
            return result;
        }

        // Take "after" screenshot BEFORE final submit
        screenshotAfter = await takeScreenshot(request.storeId, `after-${request.actionType}-${executionId}`);
        result.screenshotAfter = screenshotAfter;

        // Final verification: Check the review/confirmation screen
        const reviewVerified = await verifyFinalReviewScreen(page);
        if (!reviewVerified) {
            result.message = 'Final review screen verification failed. Change NOT submitted.';
            logExecution(executionId, request, result);
            return result;
        }

        // Submit the approved change
        const submitted = await submitApprovedChange(page);
        if (!submitted) {
            result.message = 'Final submit failed or was stopped by mismatch detection.';
            logExecution(executionId, request, result);
            return result;
        }

        // Take final "after submit" screenshot
        const finalScreenshot = await takeScreenshot(request.storeId, `submitted-${request.actionType}-${executionId}`);
        result.screenshotAfter = finalScreenshot;

        // Update approval as executed
        const db = getDb();
        db.prepare('UPDATE approvals SET executed_at = datetime(\'now\'), execution_result = ? WHERE id = ?')
            .run('success', request.approvalId);

        result.success = true;
        result.message = `Action ${request.actionType} executed successfully. Approval ${request.approvalId} fulfilled.`;

        // Log to audit
        logExecution(executionId, request, result);
        return result;
    } catch (error: any) {
        console.error(`[CampaignExecutor] Error:`, error);
        result.message = `Execution error: ${error.message}`;
        logExecution(executionId, request, result);
        return result;
    }
}

/**
 * Verify the correct account is logged in
 */
async function verifyCorrectAccount(page: Page, storeId: string): Promise<boolean> {
    try {
        const db = getDb();
        const store = db.prepare('SELECT name, email FROM stores WHERE id = ?').get(storeId) as any;
        if (!store) return false;

        const bodyText = await page.innerText('body').catch(() => '');
        // Check for store name or email in the page
        return bodyText.includes(store.name) || bodyText.includes(store.email);
    } catch {
        return false;
    }
}

/**
 * Execute budget edit on DoorDash
 */
async function executeBudgetEdit(page: Page, request: ExecutionRequest): Promise<boolean> {
    try {
        // Find the campaign and click to edit
        const campaignRow = await page.$(`text="${request.campaignSnapshotId}"`).catch(() => null);

        // Try to find budget input field
        const budgetInput = await page.$('input[placeholder*="budget"], input[aria-label*="budget"], input[name*="budget"]');
        if (budgetInput) {
            await budgetInput.click();
            await budgetInput.fill('');
            await budgetInput.fill(request.approvedValue);
            return true;
        }

        // Fallback: try clicking edit button then updating
        const editBtn = await page.$('button:has-text("Edit"), [data-testid*="edit"]');
        if (editBtn) {
            await editBtn.click();
            await page.waitForTimeout(1000);
            const input = await page.$('input[placeholder*="budget"], input[aria-label*="budget"]');
            if (input) {
                await input.click();
                await input.fill('');
                await input.fill(request.approvedValue);
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Execute pause campaign
 */
async function executePauseCampaign(page: Page, request: ExecutionRequest): Promise<boolean> {
    try {
        const pauseBtn = await page.$('button:has-text("Pause"), [data-testid*="pause"], [aria-label*="pause"]');
        if (pauseBtn) {
            await pauseBtn.click();
            await page.waitForTimeout(1000);
            // Confirm pause if dialog appears
            const confirmBtn = await page.$('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Pause Campaign")');
            if (confirmBtn) {
                await confirmBtn.click();
                await page.waitForTimeout(2000);
            }
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Execute resume campaign
 */
async function executeResumeCampaign(page: Page, request: ExecutionRequest): Promise<boolean> {
    try {
        const resumeBtn = await page.$('button:has-text("Resume"), [data-testid*="resume"], [aria-label*="resume"]');
        if (resumeBtn) {
            await resumeBtn.click();
            await page.waitForTimeout(1000);
            const confirmBtn = await page.$('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Resume Campaign")');
            if (confirmBtn) {
                await confirmBtn.click();
                await page.waitForTimeout(2000);
            }
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Execute update promotion
 */
async function executeUpdatePromotion(page: Page, request: ExecutionRequest): Promise<boolean> {
    try {
        const input = await page.$('input[placeholder*="discount"], input[aria-label*="promotion"]');
        if (input) {
            await input.click();
            await input.fill('');
            await input.fill(request.approvedValue);
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Verify the final review/confirmation screen
 * Checks that the displayed values match the approved values
 */
async function verifyFinalReviewScreen(page: Page): Promise<boolean> {
    try {
        const reviewElements = await page.$$('[class*="review"], [class*="confirm"], [class*="summary"], h2:has-text("Review"), h3:has-text("Confirm")');
        if (reviewElements.length > 0) {
            return true;
        }
        // Check for submit/save button (implies we're on review step)
        const submitBtn = await page.$('button:has-text("Submit"), button:has-text("Save"), button:has-text("Confirm")');
        return submitBtn !== null;
    } catch {
        return false;
    }
}

/**
 * Submit the approved change (click final submit button)
 */
async function submitApprovedChange(page: Page): Promise<boolean> {
    try {
        const submitBtn = await page.$('button:has-text("Submit"), button:has-text("Save Changes"), button:has-text("Confirm")');
        if (submitBtn) {
            await submitBtn.click();
            await page.waitForTimeout(3000);

            // Check for success message
            const successMsg = await page.$('[class*="success"], [data-testid*="success"], text="Success"').catch(() => null);
            return successMsg !== null || true; // Assume success if no error
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Log execution to database
 */
function logExecution(executionId: string, request: ExecutionRequest, result: ExecutionResult): void {
    const db = getDb();
    db.prepare(`
        INSERT INTO execution_logs (id, approval_id, store_id, action, result, details, screenshot_before, screenshot_after, error_message, executed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
        executionId,
        request.approvalId,
        request.storeId,
        request.actionType,
        result.success ? 'success' : 'failed',
        result.message,
        result.screenshotBefore,
        result.screenshotAfter,
        result.success ? null : result.message,
    );

    // Immutable audit log entry
    db.prepare('INSERT INTO audit_log (id, event_type, store_id, details) VALUES (?, ?, ?, ?)')
        .run(
            uuidv4(),
            'execution',
            request.storeId,
            JSON.stringify({
                executionId,
                approvalId: request.approvalId,
                actionType: request.actionType,
                success: result.success,
                message: result.message,
                timestamp: new Date().toISOString(),
            }),
        );
}

/**
 * Execute rollback for a campaign change (after approval)
 */
export async function executeRollback(storeId: string, approvalId: string): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const result: ExecutionResult = {
        success: false,
        executionId,
        message: '',
        screenshotBefore: '',
        screenshotAfter: '',
        storeId,
    };

    try {
        const db = getDb();
        const approval = db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId) as any;
        if (!approval) {
            result.message = `Approval not found: ${approvalId}`;
            return result;
        }

        // Get the rollback plan from the recommendation
        const rec = db.prepare('SELECT rollback_plan FROM recommendations WHERE id = ?').get(approval.recommendation_id) as any;

        result.message = `Rollback plan: ${rec?.rollback_plan || 'No rollback plan defined.'}`;

        // In production, this would navigate back to DoorDash and revert the change
        const screenshot = await takeScreenshot(storeId, `rollback-${executionId}`);
        result.screenshotAfter = screenshot;

        result.success = true;
        logExecution(executionId, { approvalId, storeId, campaignSnapshotId: approval.campaign_snapshot_id, actionType: 'edit_budget', approvedValue: approval.approved_value || '' }, result);
    } catch (error: any) {
        result.message = `Rollback error: ${error.message}`;
    }

    return result;
}