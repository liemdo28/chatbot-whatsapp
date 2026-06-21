/**
 * Missing Submission Detector
 * Checks each store group for missing submissions past deadline + grace.
 * Returns list of missing submissions with alert messages.
 */
const db = require("./database");
const { getStoreGroups, getExpectedSubmissions, isValidFormSubmission } = require("./submissionDueConfig");
const { t } = require("./language");
const logger = require("./logger");

/**
 * Build alert message for a missing submission.
 * Returns bilingual (ES default) message.
 */
function buildAlertMessage(storeGroup, expected, now) {
    const storeName = storeGroup.store_name;
    const deadline = expected.deadline;
    const timeStr = deadline.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });

    // Spanish default (primary)
    const esLines = [
        `\u26a0\ufe0f Food Safety form is missing.`,
        ``,
        `Store: ${storeName} / ${storeGroup.store_code}`,
        `Group: ${storeGroup.group_name}`,
        `Manager: ${storeGroup.manager_name} @${storeGroup.manager_phone}`,
        `Expected submission: ${timeStr}`,
        `Status: No readable form received.`,
        ``,
        `Please upload a clear photo of the completed Food Safety form.`,
    ];

    return {
        es: esLines.join("\n"),
        en: esLines.join("\n"),
        store_id: storeGroup.store_id,
        store_code: storeGroup.store_code,
        store_name: storeName,
        issue: "missing_submission",
        action_needed: "Upload a clear completed Food Safety form.",
        label: expected.label,
        deadline: deadline.toISOString(),
        detected_at: now.toISOString(),
    };
}

/**
 * Check for missing submissions for all enabled store groups.
 * Returns array of missing submission records.
 */
function detectMissingSubmissions(date = new Date()) {
    const now = new Date(date);
    const groups = getStoreGroups();
    const missing = [];

    for (const group of groups) {
        const expectedSubs = getExpectedSubmissions(group.store_id, date);

        for (const expected of expectedSubs) {
            const deadlineWithGrace = new Date(expected.deadline);
            deadlineWithGrace.setMinutes(deadlineWithGrace.getMinutes() + expected.grace_minutes);

            // Only check if current time is past deadline + grace
            if (now < deadlineWithGrace) continue;

            // Find valid submissions for this store on this date (after deadline, before now)
            const dayStart = new Date(expected.deadline);
            dayStart.setHours(0, 0, 0, 0);
            const submissions = db.getSubmissions({
                store_name: group.store_name,
                created_after: dayStart.toISOString(),
                created_before: now.toISOString(),
            });

            // Check if any submission qualifies as a valid form
            const hasValid = submissions.some((s) => isValidFormSubmission(s));

            if (!hasValid) {
                const alert = buildAlertMessage(group, expected, now);
                missing.push(alert);
            }
        }
    }

    logger.info("[MissingSubmissionDetector] Check complete", {
        groups_checked: groups.length,
        missing_count: missing.length,
    });

    return missing;
}

/**
 * Get dashboard data for missing submissions panel.
 */
function getSubmissionStatus(date = new Date()) {
    const groups = getStoreGroups();
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const results = [];

    for (const group of groups) {
        const expectedSubs = getExpectedSubmissions(group.store_id, date);
        const allSubs = db.getSubmissions({
            store_name: group.store_name,
            created_after: dayStart.toISOString(),
            created_before: dayEnd.toISOString(),
        });

        const now = new Date();
        const slotStatuses = [];

        for (const expected of expectedSubs) {
            const deadlineWithGrace = new Date(expected.deadline);
            deadlineWithGrace.setMinutes(deadlineWithGrace.getMinutes() + expected.grace_minutes);

            const hasValid = allSubs.some((s) => isValidFormSubmission(s));
            const hasAny = allSubs.length > 0;
            const isLate = now > deadlineWithGrace && !hasValid;

            slotStatuses.push({
                label: expected.label,
                deadline: expected.deadline.toISOString(),
                grace_minutes: expected.grace_minutes,
                has_valid_form: hasValid,
                has_any_submission: hasAny,
                is_missing: isLate,
                total_submissions: allSubs.length,
                valid_submissions: allSubs.filter((s) => isValidFormSubmission(s)).length,
            });
        }

        results.push({
            store_id: group.store_id,
            store_name: group.store_name,
            slots: slotStatuses,
            total_expected: expectedSubs.length,
            total_received: allSubs.filter((s) => isValidFormSubmission(s)).length,
            total_missing: slotStatuses.filter((s) => s.is_missing).length,
        });
    }

    return results;
}

module.exports = {
    detectMissingSubmissions,
    getSubmissionStatus,
    buildAlertMessage,
    isValidFormSubmission,
};
