/**
 * Campaign Executor
 *
 * Executes approved campaign changes on DoorDash Merchant Portal.
 * Safety model:
 * - approval must exist and be approved
 * - campaign target is resolved from the stored snapshot
 * - dry-run is the default and never mutates the DoorDash page
 * - live submit requires DD_LIVE_EXECUTION_ENABLED=true
 */
import { Locator, Page } from 'playwright';
import { getPage, takeScreenshot } from './account-session-manager.js';
import { getDb } from '../server/db/init.js';
import { v4 as uuidv4 } from 'uuid';
import { stagehandAct, AiBrowserStepResult } from '../browser/stagehand-navigation.js';
import { validateExecutionPage, BrowserQaResult } from '../qa/browser-use-qa.js';

export type CampaignActionType = 'edit_budget' | 'pause_campaign' | 'resume_campaign' | 'create_draft' | 'update_promotion';
export type ExecutionMode = 'dry_run' | 'live';

export interface ExecutionRequest {
    approvalId: string;
    storeId?: string;
    campaignSnapshotId?: string;
    actionType?: CampaignActionType;
    approvedValue?: string;
    mode?: ExecutionMode;
}

export interface ExecutionResult {
    success: boolean;
    executionId: string;
    message: string;
    screenshotBefore: string;
    screenshotAfter: string;
    storeId: string;
    mode: ExecutionMode;
    submitted: boolean;
    aiAssistance: AiBrowserStepResult[];
    qa: BrowserQaResult[];
}

interface ExecutionTarget {
    approvalId: string;
    storeId: string;
    storeName: string;
    storeEmail: string;
    campaignSnapshotId: string;
    campaignName: string;
    actionType: CampaignActionType;
    approvedValue: string;
    mode: ExecutionMode;
}

interface ApprovalRow {
    id: string;
    store_id: string;
    campaign_snapshot_id: string | null;
    action_type: string;
    proposed_value: string | null;
    approved_value: string | null;
    status: string;
    executed_at: string | null;
}

const ACTION_TYPES: CampaignActionType[] = ['edit_budget', 'pause_campaign', 'resume_campaign', 'create_draft', 'update_promotion'];

function isCampaignActionType(value: string | undefined): value is CampaignActionType {
    return !!value && ACTION_TYPES.includes(value as CampaignActionType);
}

function getRequestedMode(request: ExecutionRequest): ExecutionMode {
    if (request.mode === 'live') return 'live';
    if (request.mode === 'dry_run') return 'dry_run';
    return process.env['DD_DEFAULT_EXECUTION_MODE'] === 'live' ? 'live' : 'dry_run';
}

function liveExecutionEnabled(): boolean {
    return process.env['DD_LIVE_EXECUTION_ENABLED'] === 'true';
}

function parseBudgetValue(value: string): number | null {
    const match = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatBudgetForInput(value: string): string {
    const budget = parseBudgetValue(value);
    return budget === null ? value : String(budget);
}

function resolveExecutionTarget(request: ExecutionRequest): { valid: true; target: ExecutionTarget } | { valid: false; error: string; storeId?: string } {
    const db = getDb();
    const approval = db.prepare('SELECT * FROM approvals WHERE id = ?').get(request.approvalId) as ApprovalRow | undefined;
    if (!approval) return { valid: false, error: `Approval not found: ${request.approvalId}`, storeId: request.storeId };
    if (approval.status !== 'approved') return { valid: false, error: `Approval must be approved before execution. Current status: ${approval.status}`, storeId: approval.store_id };
    if (approval.executed_at) return { valid: false, error: `Approval already executed at ${approval.executed_at}`, storeId: approval.store_id };

    const storeId = request.storeId || approval.store_id;
    if (storeId !== approval.store_id) {
        return { valid: false, error: `Store mismatch: approval is for ${approval.store_id}, request is for ${storeId}`, storeId: approval.store_id };
    }

    const actionType = request.actionType || approval.action_type;
    if (!isCampaignActionType(actionType)) {
        return { valid: false, error: `Unsupported action type: ${actionType || 'missing'}`, storeId };
    }
    if (actionType !== approval.action_type) {
        return { valid: false, error: `Action type mismatch: approval is ${approval.action_type}, request is ${actionType}`, storeId };
    }

    const campaignSnapshotId = request.campaignSnapshotId || approval.campaign_snapshot_id || '';
    const snapshot = campaignSnapshotId
        ? db.prepare('SELECT * FROM campaign_snapshots WHERE id = ?').get(campaignSnapshotId) as any
        : null;

    if (actionType !== 'create_draft' && !snapshot?.campaign_name) {
        return { valid: false, error: 'Campaign snapshot is required so executor can target the right campaign row.', storeId };
    }

    const store = db.prepare('SELECT name, email FROM stores WHERE id = ?').get(storeId) as any;
    if (!store) return { valid: false, error: `Store not found: ${storeId}`, storeId };

    const approvedValue = request.approvedValue || approval.approved_value || approval.proposed_value || '';
    if (actionType === 'edit_budget' && parseBudgetValue(approvedValue) === null) {
        return { valid: false, error: `Approved budget value is not numeric: ${approvedValue}`, storeId };
    }

    const mode = getRequestedMode(request);
    if (mode === 'live' && !liveExecutionEnabled()) {
        return {
            valid: false,
            error: 'Live execution is disabled. Set DD_LIVE_EXECUTION_ENABLED=true after validating dry-run screenshots.',
            storeId,
        };
    }

    return {
        valid: true,
        target: {
            approvalId: approval.id,
            storeId,
            storeName: store.name,
            storeEmail: store.email,
            campaignSnapshotId,
            campaignName: snapshot?.campaign_name || '',
            actionType,
            approvedValue,
            mode,
        },
    };
}

function getActionUrl(actionType: CampaignActionType): string {
    const baseUrl = 'https://merchant.doordash.com';
    switch (actionType) {
        case 'create_draft':
            return `${baseUrl}/promotions/new`;
        case 'edit_budget':
        case 'pause_campaign':
        case 'resume_campaign':
        case 'update_promotion':
        default:
            return `${baseUrl}/promotions`;
    }
}

export async function executeApprovedChange(request: ExecutionRequest): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const mode = getRequestedMode(request);
    const result: ExecutionResult = {
        success: false,
        executionId,
        message: '',
        screenshotBefore: '',
        screenshotAfter: '',
        storeId: request.storeId || '',
        mode,
        submitted: false,
        aiAssistance: [],
        qa: [],
    };

    const resolved = resolveExecutionTarget(request);
    if (!resolved.valid) {
        result.storeId = resolved.storeId || result.storeId;
        result.message = `Guardrail block: ${resolved.error}`;
        logExecution(executionId, request, result);
        return result;
    }

    const target = resolved.target;
    result.storeId = target.storeId;
    result.mode = target.mode;

    let page: Page;
    try {
        page = await getPage(target.storeId);
    } catch (error: any) {
        result.message = `Could not open browser for ${target.storeId}: ${error.message}`;
        logExecution(executionId, request, result);
        return result;
    }

    try {
        await page.goto('https://merchant.doordash.com', { waitUntil: 'networkidle', timeout: 30000 });
        const accountVerification = await verifyCorrectAccount(page, target);
        if (!accountVerification.loggedIn) {
            result.message = 'DoorDash session is not logged in. Login is required before campaign execution.';
            logExecution(executionId, request, result);
            return result;
        }

        if (target.mode === 'live' && !accountVerification.verified && process.env['DD_ALLOW_UNVERIFIED_ACCOUNT_EXECUTION'] !== 'true') {
            result.message = 'Account verification failed. Set DD_ALLOW_UNVERIFIED_ACCOUNT_EXECUTION=true only after confirming the browser profile is the correct store.';
            logExecution(executionId, request, result);
            return result;
        }

        result.screenshotBefore = await takeScreenshot(target.storeId, `before-${target.actionType}-${executionId}`);

        await page.goto(getActionUrl(target.actionType), { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);

        let targetVisible = target.actionType === 'create_draft' || await ensureCampaignVisible(page, target.campaignName);
        if (!targetVisible) {
            const aiNavigation = await stagehandAct(page, `Find and open the DoorDash campaign or promotion named "${target.campaignName}" for management. Do not submit any changes.`, {
                storeId: target.storeId,
                campaignName: target.campaignName,
                purpose: 'execution_target_lookup',
            });
            result.aiAssistance.push(aiNavigation);
            targetVisible = aiNavigation.ok && await ensureCampaignVisible(page, target.campaignName);
        }
        if (!targetVisible) {
            result.screenshotAfter = await takeScreenshot(target.storeId, `target-not-found-${target.actionType}-${executionId}`);
            result.message = `Campaign not found on DoorDash page: ${target.campaignName}`;
            logExecution(executionId, request, result, target);
            return result;
        }

        const executionQa = await safeValidateExecutionPage(page, target.campaignName || target.actionType);
        result.qa.push(executionQa);
        if (target.mode === 'live' && !executionQa.ok && process.env['DD_ALLOW_HIGH_RISK_EXECUTION_QA'] !== 'true') {
            result.screenshotAfter = await takeScreenshot(target.storeId, `qa-block-${target.actionType}-${executionId}`);
            result.message = `Execution QA blocked live action. Risk: ${executionQa.risk}. Findings: ${executionQa.findings.join('; ')}`;
            logExecution(executionId, request, result, target);
            return result;
        }

        if (target.mode === 'dry_run') {
            result.screenshotAfter = await takeScreenshot(target.storeId, `dry-run-${target.actionType}-${executionId}`);
            result.success = true;
            result.message = `Dry-run verified ${target.actionType} target "${target.campaignName}" for ${target.storeName}. QA risk: ${executionQa.risk}. No DoorDash changes submitted.`;
            logExecution(executionId, request, result, target);
            return result;
        }

        const actionReady = await prepareLiveAction(page, target, result.aiAssistance);
        if (!actionReady) {
            result.screenshotAfter = await takeScreenshot(target.storeId, `action-not-ready-${target.actionType}-${executionId}`);
            result.message = `Could not prepare live action ${target.actionType} for "${target.campaignName}".`;
            logExecution(executionId, request, result, target);
            return result;
        }

        result.screenshotAfter = await takeScreenshot(target.storeId, `review-${target.actionType}-${executionId}`);

        const reviewVerified = await verifyFinalReviewScreen(page, target);
        if (!reviewVerified) {
            result.message = 'Final review screen/value verification failed. Change was not submitted.';
            logExecution(executionId, request, result, target);
            return result;
        }

        const submitted = await submitApprovedChange(page);
        result.submitted = submitted;
        result.screenshotAfter = await takeScreenshot(target.storeId, `submitted-${target.actionType}-${executionId}`);

        if (!submitted) {
            result.message = 'Final submit did not show a reliable success signal.';
            logExecution(executionId, request, result, target);
            return result;
        }

        getDb()
            .prepare('UPDATE approvals SET executed_at = datetime(\'now\'), execution_result = ? WHERE id = ?')
            .run('success', target.approvalId);

        result.success = true;
        result.message = `Live action ${target.actionType} submitted for "${target.campaignName}".`;
        logExecution(executionId, request, result, target);
        return result;
    } catch (error: any) {
        console.error('[CampaignExecutor] Error:', error);
        result.message = `Execution error: ${error.message}`;
        logExecution(executionId, request, result, target);
        return result;
    }
}

async function verifyCorrectAccount(page: Page, target: ExecutionTarget): Promise<{ loggedIn: boolean; verified: boolean }> {
    const bodyText = await page.innerText('body').catch(() => '');
    const lowerUrl = page.url().toLowerCase();
    const lowerBody = bodyText.toLowerCase();
    const loggedIn = !lowerUrl.includes('login') && !lowerUrl.includes('signin') && !lowerBody.includes('sign in to your account');
    const verified = bodyText.includes(target.storeName) || bodyText.includes(target.storeEmail);
    return { loggedIn, verified };
}

async function safeValidateExecutionPage(page: Page, targetDescription: string): Promise<BrowserQaResult> {
    try {
        return await validateExecutionPage(page, targetDescription);
    } catch (error: any) {
        return {
            ok: false,
            provider: 'deterministic',
            risk: 'high',
            pageUrl: page.url(),
            title: await page.title().catch(() => ''),
            findings: [`Execution QA failed: ${error.message}`],
            signals: [],
            checkedAt: new Date().toISOString(),
        };
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findCampaignText(page: Page, campaignName: string): Promise<Locator | null> {
    const exact = page.getByText(campaignName, { exact: true }).first();
    if ((await exact.count().catch(() => 0)) > 0) return exact;

    const loose = page.getByText(new RegExp(escapeRegExp(campaignName), 'i')).first();
    if ((await loose.count().catch(() => 0)) > 0) return loose;

    return null;
}

async function findCampaignContainer(page: Page, campaignName: string): Promise<Locator | null> {
    const text = await findCampaignText(page, campaignName);
    if (!text) return null;

    const candidates = [
        text.locator('xpath=ancestor::tr[1]'),
        text.locator('xpath=ancestor::*[@role="row"][1]'),
        text.locator('xpath=ancestor::article[1]'),
        text.locator('xpath=ancestor::li[1]'),
        text.locator('xpath=ancestor::*[contains(translate(@class, "CAMPAIGNPROMOTIONCARDROW", "campaignpromotioncardrow"), "campaign")][1]'),
        text.locator('xpath=ancestor::*[contains(translate(@class, "CAMPAIGNPROMOTIONCARDROW", "campaignpromotioncardrow"), "promotion")][1]'),
    ];

    for (const candidate of candidates) {
        if ((await candidate.count().catch(() => 0)) > 0) return candidate.first();
    }

    return text;
}

async function ensureCampaignVisible(page: Page, campaignName: string): Promise<boolean> {
    const text = await findCampaignText(page, campaignName);
    if (!text) return false;
    await text.scrollIntoViewIfNeeded().catch(() => undefined);
    return true;
}

async function clickFirstVisible(locators: Locator[]): Promise<boolean> {
    for (const locator of locators) {
        const count = await locator.count().catch(() => 0);
        if (count === 0) continue;

        const first = locator.first();
        const visible = await first.isVisible().catch(() => false);
        const enabled = await first.isEnabled().catch(() => false);
        if (!visible || !enabled) continue;

        await first.click();
        return true;
    }
    return false;
}

async function openCampaignEditor(page: Page, target: ExecutionTarget, aiEvents: AiBrowserStepResult[] = []): Promise<boolean> {
    const container = await findCampaignContainer(page, target.campaignName);
    if (!container) {
        const aiNavigation = await stagehandAct(page, `Open the campaign editor or management view for "${target.campaignName}". Do not submit any changes.`, {
            storeId: target.storeId,
            campaignName: target.campaignName,
            purpose: 'open_campaign_editor',
        });
        aiEvents.push(aiNavigation);
        return aiNavigation.ok;
    }

    await container.scrollIntoViewIfNeeded().catch(() => undefined);

    const clicked = await clickFirstVisible([
        container.getByRole('button', { name: /edit|manage|details|view|open/i }),
        container.locator('button:has-text("Edit"), button:has-text("Manage"), button:has-text("Details"), button:has-text("View")'),
    ]);

    if (!clicked) {
        await container.click().catch(() => undefined);
    }

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    return true;
}

async function fillBudgetInput(page: Page, value: string, target: ExecutionTarget, aiEvents: AiBrowserStepResult[] = []): Promise<boolean> {
    const budgetValue = formatBudgetForInput(value);
    const locators = [
        page.getByLabel(/budget/i),
        page.getByPlaceholder(/budget/i),
        page.locator('input[name*="budget"], input[aria-label*="budget"], input[placeholder*="budget"]'),
        page.locator('input[type="number"]'),
    ];

    for (const locator of locators) {
        const count = await locator.count().catch(() => 0);
        if (count === 0) continue;
        const input = locator.first();
        if (!(await input.isVisible().catch(() => false))) continue;
        await input.click();
        await input.fill('');
        await input.fill(budgetValue);
        return true;
    }

    const aiFill = await stagehandAct(page, `Set the campaign budget input to ${budgetValue}. Do not save, publish, confirm, or submit the change.`, {
        storeId: target.storeId,
        campaignName: target.campaignName,
        approvedValue: budgetValue,
        purpose: 'fill_budget_input',
    });
    aiEvents.push(aiFill);
    return aiFill.ok;
}

async function prepareLiveAction(page: Page, target: ExecutionTarget, aiEvents: AiBrowserStepResult[] = []): Promise<boolean> {
    switch (target.actionType) {
        case 'edit_budget':
            if (!await openCampaignEditor(page, target, aiEvents)) return false;
            return fillBudgetInput(page, target.approvedValue, target, aiEvents);
        case 'pause_campaign':
            if (!await openCampaignEditor(page, target, aiEvents)) return false;
            return clickFirstVisible([
                page.getByRole('button', { name: /^pause$/i }),
                page.getByRole('button', { name: /pause campaign/i }),
                page.locator('button:has-text("Pause")'),
            ]);
        case 'resume_campaign':
            if (!await openCampaignEditor(page, target, aiEvents)) return false;
            return clickFirstVisible([
                page.getByRole('button', { name: /^resume$/i }),
                page.getByRole('button', { name: /resume campaign/i }),
                page.locator('button:has-text("Resume")'),
            ]);
        case 'update_promotion':
            if (!await openCampaignEditor(page, target, aiEvents)) return false;
            return fillPromotionInput(page, target.approvedValue, target, aiEvents);
        case 'create_draft':
            return false;
        default:
            return false;
    }
}

async function fillPromotionInput(page: Page, value: string, target: ExecutionTarget, aiEvents: AiBrowserStepResult[] = []): Promise<boolean> {
    const locators = [
        page.getByLabel(/discount|promotion|offer/i),
        page.getByPlaceholder(/discount|promotion|offer/i),
        page.locator('input[name*="discount"], input[name*="promotion"], input[aria-label*="promotion"], input[placeholder*="discount"]'),
    ];

    for (const locator of locators) {
        const count = await locator.count().catch(() => 0);
        if (count === 0) continue;
        const input = locator.first();
        if (!(await input.isVisible().catch(() => false))) continue;
        await input.click();
        await input.fill('');
        await input.fill(value);
        return true;
    }
    const aiFill = await stagehandAct(page, `Set the promotion, offer, or discount input to "${value}". Do not save, publish, confirm, or submit the change.`, {
        storeId: target.storeId,
        campaignName: target.campaignName,
        approvedValue: value,
        purpose: 'fill_promotion_input',
    });
    aiEvents.push(aiFill);
    return aiFill.ok;
}

async function verifyFinalReviewScreen(page: Page, target: ExecutionTarget): Promise<boolean> {
    const body = await page.innerText('body').catch(() => '');
    const lowerBody = body.toLowerCase();

    if (target.actionType === 'edit_budget') {
        const budget = parseBudgetValue(target.approvedValue);
        if (budget !== null && !lowerBody.includes(String(budget).toLowerCase())) return false;
    }

    const hasReviewLanguage = /review|confirm|summary|save|submit|update|pause|resume/i.test(body);
    const hasSubmitButton = await firstSubmitButton(page).then(button => button !== null);
    return hasReviewLanguage || hasSubmitButton;
}

async function firstSubmitButton(page: Page): Promise<Locator | null> {
    const locators = [
        page.getByRole('button', { name: /save changes|save|submit|confirm|update|publish|pause campaign|resume campaign/i }),
        page.locator('button:has-text("Save Changes"), button:has-text("Save"), button:has-text("Submit"), button:has-text("Confirm"), button:has-text("Update")'),
    ];

    for (const locator of locators) {
        const count = await locator.count().catch(() => 0);
        if (count === 0) continue;
        const button = locator.first();
        if ((await button.isVisible().catch(() => false)) && (await button.isEnabled().catch(() => false))) return button;
    }
    return null;
}

async function submitApprovedChange(page: Page): Promise<boolean> {
    const button = await firstSubmitButton(page);
    if (!button) return false;

    const beforeUrl = page.url();
    await button.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2500);

    const body = (await page.innerText('body').catch(() => '')).toLowerCase();
    if (/error|failed|try again|unable to|cannot save/.test(body)) return false;
    if (/success|saved|updated|submitted|published|paused|resumed/.test(body)) return true;

    const afterUrl = page.url();
    if (afterUrl !== beforeUrl) return true;
    if (!(await button.isVisible().catch(() => false))) return true;

    return false;
}

function logExecution(executionId: string, request: ExecutionRequest, result: ExecutionResult, target?: ExecutionTarget): void {
    try {
        const storeId = target?.storeId || result.storeId || request.storeId;
        if (!storeId) return;

        const db = getDb();
        const storeExists = db.prepare('SELECT id FROM stores WHERE id = ?').get(storeId);
        if (!storeExists) return;

        db.prepare(`
            INSERT INTO execution_logs (id, approval_id, store_id, action, result, details, screenshot_before, screenshot_after, error_message, executed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
            executionId,
            request.approvalId,
            storeId,
            target?.actionType || request.actionType || 'unknown',
            result.success ? 'success' : 'failed',
            result.message,
            result.screenshotBefore,
            result.screenshotAfter,
            result.success ? null : result.message,
        );

        db.prepare('INSERT INTO audit_log (id, event_type, store_id, details) VALUES (?, ?, ?, ?)')
            .run(
                uuidv4(),
                'execution',
                storeId,
                JSON.stringify({
                    executionId,
                    approvalId: request.approvalId,
                    actionType: target?.actionType || request.actionType,
                    campaignSnapshotId: target?.campaignSnapshotId || request.campaignSnapshotId,
                    campaignName: target?.campaignName,
                    mode: result.mode,
                    submitted: result.submitted,
                    success: result.success,
                    message: result.message,
                    qa: result.qa,
                    aiAssistance: result.aiAssistance,
                    timestamp: new Date().toISOString(),
                }),
            );
    } catch (error) {
        console.error('[CampaignExecutor] Failed to write execution log:', error);
    }
}

export async function executeRollback(storeId: string, approvalId: string): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const result: ExecutionResult = {
        success: false,
        executionId,
        message: '',
        screenshotBefore: '',
        screenshotAfter: '',
        storeId,
        mode: 'dry_run',
        submitted: false,
        aiAssistance: [],
        qa: [],
    };

    try {
        const db = getDb();
        const approval = db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId) as any;
        if (!approval) {
            result.message = `Approval not found: ${approvalId}`;
            return result;
        }

        const rec = db.prepare('SELECT rollback_plan FROM recommendations WHERE id = ?').get(approval.recommendation_id) as any;
        result.message = `Rollback plan: ${rec?.rollback_plan || 'No rollback plan defined.'}`;
        result.screenshotAfter = await takeScreenshot(storeId, `rollback-${executionId}`);
        result.success = true;
        logExecution(executionId, { approvalId, storeId, campaignSnapshotId: approval.campaign_snapshot_id, actionType: 'edit_budget', approvedValue: approval.approved_value || '', mode: 'dry_run' }, result);
    } catch (error: any) {
        result.message = `Rollback error: ${error.message}`;
    }

    return result;
}
