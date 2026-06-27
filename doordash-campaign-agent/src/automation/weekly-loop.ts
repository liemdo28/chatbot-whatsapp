/**
 * Weekly Auto Loop
 * Runs every Monday at 8 AM.
 * 1. Check all 4 sessions
 * 2. Pull campaign data
 * 3. Save snapshots
 * 4. Compare previous week
 * 5. Generate recommendations
 * 6. Create CEO approval cards
 * 7. Wait for approval
 * 8. Execute approved actions
 * 9. Save screenshots
 * 10. Generate weekly report
 */
import cron from 'node-cron';
import { getDb } from '../server/db/init.js';
import { getAllSessionStatuses, canReuseSession, openBrowserSession, closeAllSessions } from '../executor/account-session-manager.js';
import { readAllStoreCampaigns } from '../executor/campaign-reader.js';
import { analyzeStoreCampaigns, Recommendation } from '../intelligence/campaign-analyzer.js';
import type { CampaignActionType } from '../executor/campaign-executor.js';
import { v4 as uuidv4 } from 'uuid';

let _cronJob: cron.ScheduledTask | null = null;

interface ApprovalDraft {
    actionType: CampaignActionType;
    proposedValue: string;
}

function extractMoneyValue(value: string): string | null {
    const match = value.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
    return match ? match[1] : null;
}

function mapRecommendationToApproval(recommendation: Recommendation): ApprovalDraft | null {
    switch (recommendation.recommendationType) {
        case 'INCREASE':
        case 'DECREASE':
        case 'TEST': {
            const budget = extractMoneyValue(recommendation.proposedSetting);
            if (!budget) return null;
            return { actionType: 'edit_budget', proposedValue: budget };
        }
        case 'PAUSE':
            return { actionType: 'pause_campaign', proposedValue: 'pause' };
        case 'ROLLBACK':
        case 'KEEP':
        case 'INFO':
        default:
            return null;
    }
}

function approvalAlreadyQueued(storeId: string, campaignSnapshotId: string | null, actionType: string, proposedValue: string): boolean {
    const db = getDb();
    const row = db.prepare(`
        SELECT id FROM approvals
        WHERE store_id = ?
        AND COALESCE(campaign_snapshot_id, '') = COALESCE(?, '')
        AND action_type = ?
        AND proposed_value = ?
        AND status IN ('pending', 'approved')
        AND executed_at IS NULL
        LIMIT 1
    `).get(storeId, campaignSnapshotId || '', actionType, proposedValue);
    return !!row;
}

/**
 * Start the weekly loop scheduler
 */
export function startWeeklyLoop(): void {
    if (_cronJob) {
        console.log('[WeeklyLoop] Already running.');
        return;
    }

    const day = process.env['WEEKLY_LOOP_DAY'] || '1'; // Monday
    const hour = process.env['WEEKLY_LOOP_HOUR'] || '8';
    const cronExpression = `0 ${hour} * * ${day}`; // Every Monday at 8 AM

    _cronJob = cron.schedule(cronExpression, async () => {
        console.log('[WeeklyLoop] Starting weekly loop run...');
        try {
            await executeWeeklyLoop();
        } catch (error) {
            console.error('[WeeklyLoop] Weekly loop error:', error);
        }
    });

    console.log(`[WeeklyLoop] Scheduler started. Cron: ${cronExpression}`);
}

/**
 * Stop the weekly loop scheduler
 */
export function stopWeeklyLoop(): void {
    if (_cronJob) {
        _cronJob.stop();
        _cronJob = null;
    }
}

/**
 * Execute the full weekly loop
 */
export async function executeWeeklyLoop(): Promise<{ success: boolean; summary: string }> {
    const db = getDb();
    const runId = uuidv4();
    const startTime = new Date().toISOString();

    // Record loop run start
    db.prepare('INSERT INTO loop_runs (id, status, started_at) VALUES (?, ?, ?)')
        .run(runId, 'running', startTime);

    const summary: string[] = [];
    let overallSuccess = true;

    try {
        // Step 1: Check all 4 sessions
        console.log('[WeeklyLoop] Step 1: Checking sessions...');
        const sessionStatuses = getAllSessionStatuses();
        const activeStores = sessionStatuses.filter(s => s.sessionStatus === 'active' || canReuseSession(s.storeId));
        summary.push(`Active/reusable sessions: ${activeStores.length}/${sessionStatuses.length}`);

        // Step 2: Open sessions and pull campaign data
        console.log('[WeeklyLoop] Step 2: Pulling campaign data...');
        const campaignResults = await readAllStoreCampaigns();
        const successfulStoreIds = new Set<string>();
        for (const [storeId, result] of Object.entries(campaignResults)) {
            if (result.success) {
                successfulStoreIds.add(storeId);
                summary.push(`${storeId}: ${result.campaigns.length} campaigns read`);
            } else {
                summary.push(`${storeId}: FAILED - ${result.message}`);
                overallSuccess = false;
            }
        }

        // Step 3: Save snapshots (already done in readCampaigns)

        // Step 4: Analyze and generate recommendations
        console.log('[WeeklyLoop] Step 3-4: Analyzing campaigns...');
        const db2 = getDb();
        const stores = db2.prepare('SELECT id, name FROM stores WHERE active = 1').all() as any[];
        let totalRecommendations = 0;
        const generatedRecommendations: Recommendation[] = [];

        for (const store of stores) {
            if (!successfulStoreIds.has(store.id)) {
                summary.push(`${store.name}: analysis skipped because fresh campaign pull failed`);
                continue;
            }
            const { analyses, recommendations } = analyzeStoreCampaigns(store.id);
            totalRecommendations += recommendations.length;
            generatedRecommendations.push(...recommendations);
            if (recommendations.length > 0) {
                summary.push(`${store.name}: ${recommendations.length} recommendations generated`);
            }
        }

        // Step 5: Create CEO approval cards
        console.log('[WeeklyLoop] Step 5: Creating approval cards...');
        let approvalCardsCreated = 0;
        for (const rec of generatedRecommendations) {
            const approvalDraft = mapRecommendationToApproval(rec);
            if (!approvalDraft) continue;
            if (approvalAlreadyQueued(rec.storeId, rec.campaignSnapshotId, approvalDraft.actionType, approvalDraft.proposedValue)) continue;

            const approvalId = uuidv4();
            db.prepare(`
                INSERT INTO approvals (id, store_id, campaign_snapshot_id, recommendation_id, action_type, proposed_value, status)
                VALUES (?, ?, ?, ?, ?, ?, 'pending')
            `).run(
                approvalId,
                rec.storeId,
                rec.campaignSnapshotId,
                rec.id,
                approvalDraft.actionType,
                approvalDraft.proposedValue,
            );
            approvalCardsCreated += 1;
        }

        if (approvalCardsCreated > 0) {
            summary.push(`${approvalCardsCreated} actionable approval cards created. Waiting for CEO review.`);
        } else if (totalRecommendations > 0) {
            summary.push('No actionable approval cards created; recommendations were informational, keep-current, or duplicates.');
        }

        // Record completion
        const endTime = new Date().toISOString();
        const finalSummary = `Weekly loop completed. ${summary.join('; ')}`;
        db.prepare('UPDATE loop_runs SET status = ?, completed_at = ?, summary = ? WHERE id = ?')
            .run('completed', endTime, finalSummary, runId);

        console.log(`[WeeklyLoop] Completed. ${finalSummary}`);

        return { success: overallSuccess, summary: finalSummary };
    } catch (error: any) {
        const endTime = new Date().toISOString();
        const errorMsg = `Weekly loop failed: ${error.message}`;
        db.prepare('UPDATE loop_runs SET status = ?, completed_at = ?, summary = ? WHERE id = ?')
            .run('failed', endTime, errorMsg, runId);

        console.error(`[WeeklyLoop] ${errorMsg}`);
        return { success: false, summary: errorMsg };
    }
}

/**
 * Get the last loop run status
 */
export function getLastLoopRun(): any {
    const db = getDb();
    return db.prepare('SELECT * FROM loop_runs ORDER BY started_at DESC LIMIT 1').get();
}

/**
 * Manually trigger weekly loop (for testing)
 */
export async function triggerManualLoop(): Promise<{ success: boolean; summary: string }> {
    console.log('[WeeklyLoop] Manual loop triggered.');
    return executeWeeklyLoop();
}
