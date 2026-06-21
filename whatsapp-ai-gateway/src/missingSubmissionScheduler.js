/**
 * Missing Submission Scheduler
 * Runs periodically to check for missing submissions and trigger alerts.
 * Uses setInterval (no cron dependency needed for Node.js).
 */
const { detectMissingSubmissions } = require("./missingSubmissionDetector");
const { buildAlertMessage } = require("./missingSubmissionDetector");
const { sendAlert } = require("./managerAlertService");
const { getStoreGroups, isValidFormSubmission } = require("./submissionDueConfig");
const db = require("./database");
const logger = require("./logger");

let schedulerInterval = null;
let isRunning = false;
let lastRun = null;
let lastResults = [];
const peerSubmissionTimers = new Map();

const DEFAULT_INTERVAL_MS = 60 * 1000; // Check every 60 seconds
const PEER_MISSING_DELAY_MS = Number(process.env.FOOD_SAFETY_PEER_MISSING_DELAY_MS || 30 * 60 * 1000);

/**
 * Start the scheduler.
 * @param {number} intervalMs - Check interval in milliseconds
 */
function start(intervalMs = DEFAULT_INTERVAL_MS) {
    if (schedulerInterval) {
        logger.warn("[Scheduler] Already running");
        return;
    }

    logger.info("[Scheduler] Starting missing submission scheduler", {
        interval_ms: intervalMs,
    });

    schedulerInterval = setInterval(async () => {
        await runCheck();
    }, intervalMs);

    // Run immediately on start
    runCheck();
}

/**
 * Stop the scheduler.
 */
function stop() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        logger.info("[Scheduler] Stopped");
    }
}

/**
 * Run a single check cycle.
 */
async function runCheck() {
    if (isRunning) {
        logger.warn("[Scheduler] Check already in progress, skipping");
        return { skipped: true };
    }

    isRunning = true;
    try {
        const missing = detectMissingSubmissions();
        const results = [];

        for (const alert of missing) {
            try {
                const result = await sendAlert(alert);
                results.push({
                    store_id: alert.store_id,
                    label: alert.label,
                    ...result,
                });
            } catch (e) {
                logger.error("[Scheduler] Failed to send alert", {
                    error: e.message,
                    store_id: alert.store_id,
                });
                results.push({
                    store_id: alert.store_id,
                    label: alert.label,
                    sent: false,
                    error: e.message,
                });
            }
        }

        lastRun = new Date().toISOString();
        lastResults = results;

        if (missing.length > 0) {
            logger.info("[Scheduler] Check complete — missing submissions found", {
                missing: missing.length,
                alerts_sent: results.filter((r) => r.sent).length,
            });
        }

        return { missing: missing.length, results };
    } catch (e) {
        logger.error("[Scheduler] Check failed", { error: e.message });
        return { error: e.message };
    } finally {
        isRunning = false;
    }
}

/**
 * Get scheduler status.
 */
function getStatus() {
    return {
        running: !!schedulerInterval,
        is_checking: isRunning,
        last_run: lastRun,
        last_results: lastResults,
    };
}

function hasValidSubmissionToday(group, now = new Date()) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const submissions = db.getSubmissions({
        store_name: group.store_name,
        created_after: dayStart.toISOString(),
        created_before: now.toISOString(),
    });
    return submissions.some((submission) => isValidFormSubmission(submission));
}

async function runPeerMissingCheck(submittedStoreCode, now = new Date()) {
    const groups = getStoreGroups();
    const missingGroups = groups.filter((group) => group.store_code !== submittedStoreCode && !hasValidSubmissionToday(group, now));
    const results = [];

    for (const group of missingGroups) {
        const expected = {
            label: `Peer reminder after ${submittedStoreCode} submission`,
            deadline: now,
            grace_minutes: 30,
        };
        const alert = buildAlertMessage(group, expected, now);
        alert.issue = "peer_missing_submission";
        alert.action_needed = `Another log group (${submittedStoreCode}) submitted. This store still needs its valid Food Safety form.`;
        try {
            const result = await sendAlert(alert, group);
            results.push({ store_code: group.store_code, ...result });
        } catch (err) {
            logger.error("[Scheduler] Peer missing check alert failed", {
                store_code: group.store_code,
                error: err.message,
            });
            results.push({ store_code: group.store_code, sent: false, error: err.message });
        }
    }

    logger.info("[Scheduler] Peer missing check complete", {
        submittedStoreCode,
        missing_count: missingGroups.length,
        alerts_sent: results.filter((result) => result.sent).length,
    });
    return { missing: missingGroups.length, results };
}

function onValidSubmission(submittedStoreCode) {
    if (!submittedStoreCode) return;
    if (peerSubmissionTimers.has(submittedStoreCode)) {
        clearTimeout(peerSubmissionTimers.get(submittedStoreCode));
    }
    const timer = setTimeout(() => {
        peerSubmissionTimers.delete(submittedStoreCode);
        runPeerMissingCheck(submittedStoreCode).catch((err) => {
            logger.error("[Scheduler] Peer missing check failed", { error: err.message, submittedStoreCode });
        });
    }, PEER_MISSING_DELAY_MS);
    if (timer.unref) timer.unref();
    peerSubmissionTimers.set(submittedStoreCode, timer);
}

module.exports = {
    start,
    stop,
    runCheck,
    getStatus,
    onValidSubmission,
    runPeerMissingCheck,
    hasValidSubmissionToday,
};
