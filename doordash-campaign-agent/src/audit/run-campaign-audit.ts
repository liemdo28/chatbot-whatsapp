import 'dotenv/config';
import { runCampaignAudit } from './campaign-audit.js';
import { closeAllSessions } from '../executor/account-session-manager.js';
import { closeDb } from '../server/db/init.js';
import { closeStagehand } from '../browser/stagehand-navigation.js';

async function main(): Promise<void> {
    const report = await runCampaignAudit();
    console.log(JSON.stringify({
        ok: report.summary.freshCampaignsPulled > 0,
        runId: report.runId,
        summary: report.summary,
        reportPaths: report.reportPaths,
        autonomousAdjustmentsEnabled: report.autonomousAdjustmentsEnabled,
        executionMode: report.executionMode,
        liveExecutionEnabled: report.liveExecutionEnabled,
    }, null, 2));

    if (report.summary.freshCampaignsPulled === 0) {
        process.exitCode = 2;
    }
}

main()
    .catch(error => {
        console.error('[CampaignAudit] Failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeStagehand().catch(() => undefined);
        await closeAllSessions().catch(() => undefined);
        closeDb();
    });
