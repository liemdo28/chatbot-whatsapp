import crypto from 'crypto';
import path from 'path';
import { getDb } from '../server/db/init.js';
import type { ParsedMarketingCampaign, ParsedMarketingReport } from './marketing-report-parser.js';
import type { WeeklyReportingWindow } from '../automation/weekly-reporting-window.js';
import { campaignMatchesStore } from './marketing-report-store-match.js';

export interface WeeklySnapshotSyncResult {
    storeId: string;
    weekStart: string;
    source: string;
    batchId: string;
    campaignCount: number;
    created: number;
    updated: number;
    unchanged: number;
    skipped: number;
    snapshotIds: string[];
}

function normalizeName(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stableSnapshotId(storeId: string, weekStart: string, campaignId: string, campaignName: string, source: string): string {
    const hash = crypto
        .createHash('sha256')
        .update([storeId, weekStart, campaignId || normalizeName(campaignName), source].join('|'))
        .digest('hex')
        .slice(0, 24);
    return `snapshot-${storeId}-${weekStart}-${hash}`;
}

function completenessScore(campaign: ParsedMarketingCampaign): number {
    let score = 0;
    if (Number.isFinite(campaign.orders)) score += 1;
    if (Number.isFinite(campaign.sales)) score += 1;
    if (Number.isFinite(campaign.spend)) score += 1;
    if (Number.isFinite(campaign.roas)) score += 1;
    return score;
}

function inferStatus(campaign: ParsedMarketingCampaign, window: WeeklyReportingWindow): string {
    const end = (campaign.endDate || '').trim();
    if (!end || end.toLowerCase() === 'none') return 'active';
    return end >= window.weekEndExclusive ? 'active' : 'ended';
}

function normalizeType(campaign: ParsedMarketingCampaign): string {
    const type = campaign.campaignType.toLowerCase();
    if (type.includes('sponsored')) return 'sponsored_listing';
    if (type.includes('promotion')) return 'promotion';
    return type.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

export function syncWeeklyReportSnapshots(input: {
    storeId: string;
    parsedReport: ParsedMarketingReport;
    window: WeeklyReportingWindow;
    batchId: string;
    source?: string;
}): WeeklySnapshotSyncResult {
    const db = getDb();
    const source = input.source || 'marketing_report_weekly';
    const sourceRef = path.basename(input.parsedReport.reportPath);
    const store = db.prepare('SELECT id, name, doorDashAccountId FROM stores WHERE id = ?').get(input.storeId) as {
        id: string;
        name?: string | null;
        doorDashAccountId?: string | null;
    } | undefined;
    const campaigns = input.parsedReport.campaigns.filter(campaign => campaignMatchesStore(campaign, {
        id: input.storeId,
        name: store?.name || input.storeId,
        doorDashAccountId: store?.doorDashAccountId || null,
    }));

    if (campaigns.length === 0) {
        throw new Error(`No marketing-report campaigns were found for store ${input.storeId} in ${sourceRef}.`);
    }

    const insertOrUpdate = db.prepare(`
        INSERT INTO campaign_snapshots (
            id, store_id, campaign_name, campaign_type, status, budget, spend, sales, orders, roas,
            start_date, end_date, currency, raw_data, screenshot_path, snapshot_date, week_start, created_at,
            snapshot_source, source_ref, batch_id, report_start_date, report_end_date, data_completeness, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, '', datetime('now'), ?, datetime('now'), ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            campaign_type=excluded.campaign_type,
            status=CASE
                WHEN excluded.data_completeness >= COALESCE(campaign_snapshots.data_completeness, 0) THEN excluded.status
                ELSE campaign_snapshots.status
            END,
            spend=CASE
                WHEN excluded.data_completeness >= COALESCE(campaign_snapshots.data_completeness, 0) THEN excluded.spend
                ELSE campaign_snapshots.spend
            END,
            sales=CASE
                WHEN excluded.data_completeness >= COALESCE(campaign_snapshots.data_completeness, 0) THEN excluded.sales
                ELSE campaign_snapshots.sales
            END,
            orders=CASE
                WHEN excluded.data_completeness >= COALESCE(campaign_snapshots.data_completeness, 0) THEN excluded.orders
                ELSE campaign_snapshots.orders
            END,
            roas=CASE
                WHEN excluded.data_completeness >= COALESCE(campaign_snapshots.data_completeness, 0) THEN excluded.roas
                ELSE campaign_snapshots.roas
            END,
            start_date=COALESCE(excluded.start_date, campaign_snapshots.start_date),
            end_date=COALESCE(excluded.end_date, campaign_snapshots.end_date),
            raw_data=CASE
                WHEN excluded.data_completeness >= COALESCE(campaign_snapshots.data_completeness, 0) THEN excluded.raw_data
                ELSE campaign_snapshots.raw_data
            END,
            snapshot_date=datetime('now'),
            week_start=excluded.week_start,
            snapshot_source=excluded.snapshot_source,
            source_ref=excluded.source_ref,
            batch_id=excluded.batch_id,
            report_start_date=excluded.report_start_date,
            report_end_date=excluded.report_end_date,
            data_completeness=MAX(COALESCE(campaign_snapshots.data_completeness, 0), excluded.data_completeness),
            updated_at=datetime('now')
    `);

    const result: WeeklySnapshotSyncResult = {
        storeId: input.storeId,
        weekStart: input.window.weekStart,
        source,
        batchId: input.batchId,
        campaignCount: campaigns.length,
        created: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        snapshotIds: [],
    };

    const tx = db.transaction(() => {
        for (const campaign of campaigns) {
            const snapshotId = stableSnapshotId(input.storeId, input.window.weekStart, campaign.campaignId, campaign.campaignName, source);
            const completeness = completenessScore(campaign);
            if (completeness < 4) {
                result.skipped += 1;
                continue;
            }

            const existing = db.prepare('SELECT id, orders, sales, spend, roas, status, data_completeness FROM campaign_snapshots WHERE id = ?').get(snapshotId) as any;
            const nextStatus = inferStatus(campaign, input.window);
            const rawData = JSON.stringify({
                source: 'marketing_report_zip',
                reportPath: input.parsedReport.reportPath,
                extractedFiles: input.parsedReport.extractedFiles,
                campaign,
            });

            if (existing && Number(existing.data_completeness ?? 0) > completeness) {
                result.skipped += 1;
                result.snapshotIds.push(snapshotId);
                continue;
            }

            insertOrUpdate.run(
                snapshotId,
                input.storeId,
                campaign.campaignName,
                normalizeType(campaign),
                nextStatus,
                null,
                campaign.spend,
                campaign.sales,
                campaign.orders,
                campaign.roas,
                campaign.startDate || null,
                campaign.endDate || null,
                rawData,
                input.window.weekStart,
                source,
                sourceRef,
                input.batchId,
                input.window.startLabel,
                input.window.endLabel,
                completeness,
            );

            if (!existing) {
                result.created += 1;
            } else if (
                Number(existing.orders ?? 0) === Number(campaign.orders ?? 0)
                && Number(existing.sales ?? 0) === Number(campaign.sales ?? 0)
                && Number(existing.spend ?? 0) === Number(campaign.spend ?? 0)
                && Number(existing.roas ?? 0) === Number(campaign.roas ?? 0)
                && String(existing.status || '') === nextStatus
            ) {
                result.unchanged += 1;
            } else {
                result.updated += 1;
            }

            result.snapshotIds.push(snapshotId);
        }
    });

    tx();

    if (result.snapshotIds.length === 0) {
        throw new Error(`Weekly snapshot sync for ${input.storeId} produced no complete campaign rows from ${sourceRef}.`);
    }

    return result;
}
