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
import { analyzeStoreCampaigns, getPendingRecommendations } from '../intelligence/campaign-analyzer.js';
import { v4 as uuidv4 } from 'uuid';

let _cronJob: cron.ScheduledTask | null = null;

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
        for (const [storeId, result] of Object.entries(campaignResults)) {
            if (result.success) {
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

        for (const store of stores) {
            const { analyses, recommendations } = analyzeStoreCampaigns(store.id);
            totalRecommendations += recommendations.length;
            if (recommendations.length > 0) {
                summary.push(`${store.name}: ${recommendations.length} recommendations generated`);
            }
        }

        // Step 5: Create CEO approval cards
        console.log('[WeeklyLoop] Step 5: Creating approval cards...');
        const pending = getPendingRecommendations();
        for (const rec of pending) {
            const approvalId = uuidv4();
            db.prepare(`
                INSERT INTO approvals (id, store_id, campaign_snapshot_id, recommendation_id, action_type, proposed_value, status)
                VALUES (?, ?, ?, ?, ?, ?, 'pending')
            `).run(
                approvalId,
                rec.store_id,
                rec.campaign_snapshot_id,
                rec.id,
                rec.recommendation_type,
                rec.proposed_setting,
            );
        }

        if (pending.length > 0) {
            summary.push(`${pending.length} approval cards created. Waiting for CEO review.`);
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