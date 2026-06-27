import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../server/db/init.js';
import { readAllStoreCampaigns, CampaignData, CampaignReadResult } from '../executor/campaign-reader.js';
import { analyzeStoreCampaigns, CampaignAnalysis, Recommendation } from '../intelligence/campaign-analyzer.js';
import { executeApprovedChange, CampaignActionType, ExecutionMode, ExecutionResult } from '../executor/campaign-executor.js';
import { getAllSessionStatuses } from '../executor/account-session-manager.js';
import { AiBrowserStepResult } from '../browser/stagehand-navigation.js';
import { BrowserQaResult } from '../qa/browser-use-qa.js';

interface ApprovalDraft {
    actionType: CampaignActionType;
    proposedValue: string;
}

interface QueuedApproval {
    id: string;
    actionType: CampaignActionType;
    proposedValue: string;
    status: string;
    existing: boolean;
}

export interface StoreAuditResult {
    storeId: string;
    storeName: string;
    pullSuccess: boolean;
    pullMessage: string;
    campaignCount: number;
    snapshotIds: string[];
    screenshotPaths: string[];
    aiNavigation?: AiBrowserStepResult;
    qa?: BrowserQaResult;
    campaigns: CampaignData[];
    analyses: CampaignAnalysis[];
    recommendations: Recommendation[];
    approvals: QueuedApproval[];
    executions: ExecutionResult[];
}

export interface CampaignAuditReport {
    runId: string;
    startedAt: string;
    completedAt: string;
    autonomousAdjustmentsEnabled: boolean;
    executionMode: ExecutionMode;
    liveExecutionEnabled: boolean;
    summary: {
        storesAudited: number;
        storesPulled: number;
        freshCampaignsPulled: number;
        recommendationsGenerated: number;
        approvalsQueued: number;
        executionsAttempted: number;
        executionsSubmitted: number;
    };
    sessionsBefore: ReturnType<typeof getAllSessionStatuses>;
    stores: StoreAuditResult[];
    reportPaths: {
        json: string;
        markdown: string;
    };
}

function reportsDir(): string {
    return path.resolve(process.env['AUDIT_REPORTS_DIR'] || './data/audit-reports');
}

function timestampForFile(date = new Date()): string {
    return date.toISOString().replace(/[:.]/g, '-');
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
            const numericBudget = Number(budget);
            if (!Number.isFinite(numericBudget) || numericBudget <= 0) return null;
            return { actionType: 'edit_budget', proposedValue: budget };
        }
        case 'PAUSE':
            return { actionType: 'pause_campaign', proposedValue: 'pause' };
        default:
            return null;
    }
}

function queueApproval(recommendation: Recommendation, draft: ApprovalDraft): QueuedApproval {
    const db = getDb();
    const existing = db.prepare(`
        SELECT id, status FROM approvals
        WHERE store_id = ?
        AND COALESCE(campaign_snapshot_id, '') = COALESCE(?, '')
        AND action_type = ?
        AND proposed_value = ?
        AND status IN ('pending', 'approved')
        AND executed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
    `).get(
        recommendation.storeId,
        recommendation.campaignSnapshotId || '',
        draft.actionType,
        draft.proposedValue,
    ) as any;

    if (existing) {
        return {
            id: existing.id,
            actionType: draft.actionType,
            proposedValue: draft.proposedValue,
            status: existing.status,
            existing: true,
        };
    }

    const approvalId = uuidv4();
    db.prepare(`
        INSERT INTO approvals (id, store_id, campaign_snapshot_id, recommendation_id, action_type, proposed_value, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(
        approvalId,
        recommendation.storeId,
        recommendation.campaignSnapshotId,
        recommendation.id,
        draft.actionType,
        draft.proposedValue,
    );

    return {
        id: approvalId,
        actionType: draft.actionType,
        proposedValue: draft.proposedValue,
        status: 'pending',
        existing: false,
    };
}

function approveQueuedApproval(approvalId: string, approvedBy: string): void {
    const db = getDb();
    db.prepare(`
        UPDATE approvals
        SET status = 'approved',
            approved_by = ?,
            approved_at = datetime('now'),
            approved_value = COALESCE(approved_value, proposed_value)
        WHERE id = ? AND status = 'pending'
    `).run(approvedBy, approvalId);
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function formatMetric(value: number | null | undefined, suffix = ''): string {
    if (value === null || value === undefined) return 'n/a';
    return `${Number(value).toFixed(2)}${suffix}`;
}

function renderMarkdown(report: CampaignAuditReport): string {
    const lines: string[] = [];
    lines.push(`# DoorDash Campaign Audit`);
    lines.push('');
    lines.push(`Run ID: ${report.runId}`);
    lines.push(`Started: ${report.startedAt}`);
    lines.push(`Completed: ${report.completedAt}`);
    lines.push(`Autonomous adjustments: ${report.autonomousAdjustmentsEnabled ? 'enabled' : 'disabled'}`);
    lines.push(`Execution mode: ${report.executionMode}`);
    lines.push(`Live execution enabled: ${report.liveExecutionEnabled ? 'yes' : 'no'}`);
    lines.push('');
    lines.push(`## Summary`);
    lines.push('');
    lines.push(`- Stores audited: ${report.summary.storesAudited}`);
    lines.push(`- Stores with fresh campaign data: ${report.summary.storesPulled}`);
    lines.push(`- Fresh campaigns pulled: ${report.summary.freshCampaignsPulled}`);
    lines.push(`- Recommendations generated: ${report.summary.recommendationsGenerated}`);
    lines.push(`- Approval actions queued: ${report.summary.approvalsQueued}`);
    lines.push(`- Executions attempted: ${report.summary.executionsAttempted}`);
    lines.push(`- Live submissions confirmed: ${report.summary.executionsSubmitted}`);
    lines.push('');
    lines.push(`## Session State Before Audit`);
    lines.push('');
    lines.push(`| Store | Session | Browser | Last login | 2FA |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const session of report.sessionsBefore) {
        lines.push(`| ${session.storeName} | ${session.sessionStatus} | ${session.browserConnected ? 'connected' : 'not connected'} | ${session.lastLoginAt || 'n/a'} | ${session.twoFaStatus} |`);
    }
    lines.push('');

    for (const store of report.stores) {
        lines.push(`## ${store.storeName}`);
        lines.push('');
        lines.push(`Pull result: ${store.pullSuccess ? 'success' : 'failed'} - ${store.pullMessage}`);
        lines.push(`Campaigns pulled: ${store.campaignCount}`);
        lines.push('');
        lines.push(`Navigation and QA:`);
        if (store.aiNavigation) {
            lines.push(`- AI navigation: ${store.aiNavigation.provider}/${store.aiNavigation.status} - ${store.aiNavigation.message}`);
        } else {
            lines.push(`- AI navigation: deterministic Playwright path completed or no AI fallback was needed.`);
        }
        if (store.qa) {
            lines.push(`- QA provider: ${store.qa.provider}`);
            lines.push(`- QA risk: ${store.qa.risk} (${store.qa.ok ? 'pass' : 'review required'})`);
            lines.push(`- QA page: ${store.qa.pageUrl || 'n/a'}`);
            for (const finding of store.qa.findings.slice(0, 4)) {
                lines.push(`- QA finding: ${finding}`);
            }
        } else {
            lines.push(`- QA: n/a`);
        }
        lines.push('');
        lines.push(`Screenshots:`);
        if (store.screenshotPaths.length === 0) {
            lines.push(`- n/a`);
        } else {
            for (const screenshot of store.screenshotPaths) {
                lines.push(`- ${screenshot}`);
            }
        }
        lines.push('');

        if (store.campaigns.length > 0) {
            lines.push(`Campaign data:`);
            lines.push('');
            lines.push(`| Campaign | Status | Budget | Spend | Sales | Orders | ROAS |`);
            lines.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: |`);
            for (const campaign of store.campaigns) {
                lines.push(`| ${campaign.campaignName} | ${campaign.status} | ${formatMetric(campaign.budget)} | ${formatMetric(campaign.spend)} | ${formatMetric(campaign.sales)} | ${campaign.orders ?? 'n/a'} | ${formatMetric(campaign.roas, 'x')} |`);
            }
            lines.push('');
        }

        if (store.recommendations.length > 0) {
            lines.push(`Strategy and recommended adjustments:`);
            lines.push('');
            for (const rec of store.recommendations) {
                lines.push(`- ${rec.recommendationType}: ${rec.proposedSetting} (${Math.round(rec.confidence * 100)}% confidence, ${rec.risk} risk). ${rec.reason}`);
            }
            lines.push('');
        } else if (store.pullSuccess) {
            lines.push(`Strategy and recommended adjustments: no recommendations generated from the latest pull.`);
            lines.push('');
        }

        if (store.approvals.length > 0) {
            lines.push(`Queued adjustment actions:`);
            lines.push('');
            for (const approval of store.approvals) {
                lines.push(`- ${approval.actionType}: ${approval.proposedValue} (approval ${approval.id}, ${approval.existing ? 'already queued' : 'new'}, status ${approval.status})`);
            }
            lines.push('');
        }

        if (store.executions.length > 0) {
            lines.push(`Execution evidence:`);
            lines.push('');
            for (const execution of store.executions) {
                lines.push(`- ${execution.mode} ${execution.submitted ? 'submitted' : 'not submitted'}: ${execution.message}`);
                for (const qa of execution.qa.slice(0, 2)) {
                    lines.push(`  - QA: ${qa.risk} ${qa.ok ? 'pass' : 'review'} (${qa.findings.slice(0, 2).join('; ')})`);
                }
                for (const ai of execution.aiAssistance.slice(0, 3)) {
                    lines.push(`  - AI: ${ai.provider}/${ai.status} - ${ai.message}`);
                }
                if (execution.screenshotBefore) lines.push(`  - before: ${execution.screenshotBefore}`);
                if (execution.screenshotAfter) lines.push(`  - after: ${execution.screenshotAfter}`);
            }
            lines.push('');
        }
    }

    return `${lines.join('\n')}\n`;
}

export async function runCampaignAudit(options: {
    autonomousAdjustments?: boolean;
    executionMode?: ExecutionMode;
    approvedBy?: string;
} = {}): Promise<CampaignAuditReport> {
    const runId = uuidv4();
    const startedAt = new Date().toISOString();
    const db = getDb();
    const stores = db.prepare('SELECT id, name FROM stores WHERE active = 1 ORDER BY name').all() as any[];
    const sessionsBefore = getAllSessionStatuses();
    const autonomousAdjustmentsEnabled = options.autonomousAdjustments ?? process.env['DD_AUTONOMOUS_CAMPAIGN_ADJUSTMENTS'] === 'true';
    const executionMode: ExecutionMode = options.executionMode || (process.env['DD_AUDIT_EXECUTION_MODE'] === 'live' ? 'live' : 'dry_run');
    const liveExecutionEnabled = process.env['DD_LIVE_EXECUTION_ENABLED'] === 'true';

    const readResults: Record<string, CampaignReadResult> = await readAllStoreCampaigns();
    const storeResults: StoreAuditResult[] = [];

    for (const store of stores) {
        const readResult = readResults[store.id];
        const analyses: CampaignAnalysis[] = [];
        const recommendations: Recommendation[] = [];
        const approvals: QueuedApproval[] = [];
        const executions: ExecutionResult[] = [];

        if (readResult?.success && readResult.campaigns.length > 0) {
            const analysisResult = analyzeStoreCampaigns(store.id);
            analyses.push(...analysisResult.analyses);
            recommendations.push(...analysisResult.recommendations);

            for (const recommendation of recommendations) {
                const draft = mapRecommendationToApproval(recommendation);
                if (!draft) continue;

                const approval = queueApproval(recommendation, draft);
                approvals.push(approval);

                if (autonomousAdjustmentsEnabled) {
                    approveQueuedApproval(approval.id, options.approvedBy || 'Campaign Audit Agent');
                    approval.status = 'approved';
                    executions.push(await executeApprovedChange({
                        approvalId: approval.id,
                        mode: executionMode,
                    }));
                }
            }
        }

        storeResults.push({
            storeId: store.id,
            storeName: store.name,
            pullSuccess: !!readResult?.success,
            pullMessage: readResult?.message || 'No read result returned.',
            campaignCount: readResult?.campaigns.length || 0,
            snapshotIds: readResult?.snapshotIds || [],
            screenshotPaths: unique(readResult?.screenshotPaths || []),
            aiNavigation: readResult?.aiNavigation,
            qa: readResult?.qa,
            campaigns: readResult?.campaigns || [],
            analyses,
            recommendations,
            approvals,
            executions,
        });
    }

    const completedAt = new Date().toISOString();
    const report: CampaignAuditReport = {
        runId,
        startedAt,
        completedAt,
        autonomousAdjustmentsEnabled,
        executionMode,
        liveExecutionEnabled,
        summary: {
            storesAudited: storeResults.length,
            storesPulled: storeResults.filter(store => store.pullSuccess).length,
            freshCampaignsPulled: storeResults.reduce((sum, store) => sum + store.campaignCount, 0),
            recommendationsGenerated: storeResults.reduce((sum, store) => sum + store.recommendations.length, 0),
            approvalsQueued: storeResults.reduce((sum, store) => sum + store.approvals.length, 0),
            executionsAttempted: storeResults.reduce((sum, store) => sum + store.executions.length, 0),
            executionsSubmitted: storeResults.reduce((sum, store) => sum + store.executions.filter(execution => execution.submitted).length, 0),
        },
        sessionsBefore,
        stores: storeResults,
        reportPaths: {
            json: '',
            markdown: '',
        },
    };

    const dir = reportsDir();
    await fs.mkdir(dir, { recursive: true });
    const base = `campaign-audit-${timestampForFile(new Date(startedAt))}`;
    report.reportPaths = {
        json: path.join(dir, `${base}.json`),
        markdown: path.join(dir, `${base}.md`),
    };

    await fs.writeFile(report.reportPaths.markdown, renderMarkdown(report), 'utf8');
    await fs.writeFile(report.reportPaths.json, JSON.stringify(report, null, 2), 'utf8');

    db.prepare('INSERT INTO audit_log (id, event_type, store_id, details) VALUES (?, ?, ?, ?)')
        .run(
            uuidv4(),
            'campaign_audit',
            null,
            JSON.stringify({
                runId,
                reportPaths: report.reportPaths,
                summary: report.summary,
                completedAt,
            }),
        );

    return report;
}
