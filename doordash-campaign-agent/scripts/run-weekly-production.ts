import fs from 'fs';
import { runWeeklyProductionWorkflow } from '../src/production/run-weekly-production.js';

function parseArgs(argv: string[]): { trigger: string; storeIds: string[]; weekStart?: string; weekEndExclusive?: string } {
    const result: { trigger: string; storeIds: string[]; weekStart?: string; weekEndExclusive?: string } = {
        trigger: 'manual',
        storeIds: [],
    };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        const next = argv[index + 1];
        if (token === '--trigger' && next) {
            result.trigger = next;
            index += 1;
        } else if (token === '--stores' && next) {
            result.storeIds = next.split(',').map(item => item.trim()).filter(Boolean);
            index += 1;
        } else if (token === '--week-start' && next) {
            result.weekStart = next;
            index += 1;
        } else if (token === '--week-end-exclusive' && next) {
            result.weekEndExclusive = next;
            index += 1;
        }
    }
    return result;
}

function writeGithubOutputs(result: Awaited<ReturnType<typeof runWeeklyProductionWorkflow>>): void {
    const outputPath = process.env['GITHUB_OUTPUT'];
    if (!outputPath) {
        return;
    }

    fs.appendFileSync(outputPath, `pending_external_data=${result.pendingExternalData ? 'true' : 'false'}\n`);
    fs.appendFileSync(outputPath, `failure_category=${result.failureCategory}\n`);
}

(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await runWeeklyProductionWorkflow({
        trigger: args.trigger,
        storeIds: args.storeIds,
        weekStart: args.weekStart,
        weekEndExclusive: args.weekEndExclusive,
    });
    writeGithubOutputs(result);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) {
        process.exitCode = 1;
    }
})().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
