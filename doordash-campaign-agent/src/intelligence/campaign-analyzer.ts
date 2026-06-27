/**
 * Campaign Analyzer
 * Analyzes campaign performance and generates recommendations.
 * Primary KPI: Profit first, ROI second, Sales third.
 */
import { getDb } from '../server/db/init.js';
import { v4 as uuidv4 } from 'uuid';
import { CampaignData } from '../executor/campaign-reader.js';

export interface CampaignAnalysis {
    id: string;
    storeId: string;
    campaignName: string;
    campaignType: string;
    status: string;
    currentBudget: number | null;
    currentSpend: number | null;
    currentSales: number | null;
    currentOrders: number | null;
    currentRoas: number | null;
    estimatedProfit: number;
    profitMargin: number;
    trendVsPrevious: 'up' | 'down' | 'flat' | 'no_data';
    previousPeriodSpend: number | null;
    previousPeriodSales: number | null;
}

export interface Recommendation {
    id: string;
    storeId: string;
    campaignSnapshotId: string | null;
    recommendationType: 'INCREASE' | 'DECREASE' | 'PAUSE' | 'TEST' | 'KEEP' | 'ROLLBACK' | 'INFO';
    currentSetting: string;
    proposedSetting: string;
    expectedRoiImpact: number | null;
    expectedProfitImpact: number | null;
    confidence: number;
    risk: 'low' | 'medium' | 'high';
    reason: string;
    rollbackPlan: string;
    status: 'pending' | 'approved' | 'rejected' | 'executed';
}

/**
 * Estimate profit from campaign data.
 * Uses a default margin model (can be overridden by MI-CORE rules).
 */
function estimateProfit(sales: number, spend: number, marginPercent: number = 0.20): number {
    const grossProfit = sales * marginPercent;
    return grossProfit - spend;
}

/**
 * Calculate ROAS from spend and sales
 */
function calculateRoas(spend: number, sales: number): number {
    if (spend <= 0) return 0;
    return sales / spend;
}

function hasPositiveBudget(value: number | null): value is number {
    return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * Get previous period campaign data for trend comparison
 */
function getPreviousPeriodData(storeId: string, campaignName: string): { spend: number | null; sales: number | null } | null {
    const db = getDb();
    const row = db.prepare(`
        SELECT spend, sales FROM campaign_snapshots 
        WHERE store_id = ? AND campaign_name = ? 
        AND week_start < (SELECT MAX(week_start) FROM campaign_snapshots WHERE store_id = ?)
        ORDER BY week_start DESC LIMIT 1
    `).get(storeId, campaignName, storeId) as any;

    if (!row) return null;
    return { spend: row.spend, sales: row.sales };
}

function getLatestSnapshotRows(storeId: string): any[] {
    const db = getDb();
    const latest = db.prepare(`
        SELECT screenshot_path, created_at
        FROM campaign_snapshots
        WHERE store_id = ?
        ORDER BY datetime(created_at) DESC, rowid DESC
        LIMIT 1
    `).get(storeId) as any;

    if (!latest) return [];

    if (latest.screenshot_path) {
        return db.prepare(`
            SELECT * FROM campaign_snapshots
            WHERE store_id = ? AND screenshot_path = ?
            ORDER BY campaign_name
        `).all(storeId, latest.screenshot_path) as any[];
    }

    return db.prepare(`
        SELECT * FROM campaign_snapshots
        WHERE store_id = ? AND created_at = ?
        ORDER BY campaign_name
    `).all(storeId, latest.created_at) as any[];
}

/**
 * Analyze a single campaign
 */
function analyzeCampaign(snapshot: CampaignData, storeId: string): CampaignAnalysis {
    const profitMargin = 0.20; // Default 20% margin; override via MI-CORE
    const spend = snapshot.spend ?? 0;
    const sales = snapshot.sales ?? 0;
    const estimatedProfit = estimateProfit(sales, spend, profitMargin);
    const roas = snapshot.roas ?? (spend > 0 ? calculateRoas(spend, sales) : 0);

    const prev = getPreviousPeriodData(storeId, snapshot.campaignName);
    let trend: CampaignAnalysis['trendVsPrevious'] = 'no_data';
    if (prev && prev.spend !== null && prev.sales !== null) {
        if (sales > (prev.sales ?? 0) * 1.05) trend = 'up';
        else if (sales < (prev.sales ?? 0) * 0.95) trend = 'down';
        else trend = 'flat';
    }

    return {
        id: snapshot.id,
        storeId,
        campaignName: snapshot.campaignName,
        campaignType: snapshot.campaignType,
        status: snapshot.status,
        currentBudget: snapshot.budget,
        currentSpend: spend,
        currentSales: sales,
        currentOrders: snapshot.orders,
        currentRoas: roas,
        estimatedProfit,
        profitMargin,
        trendVsPrevious: trend,
        previousPeriodSpend: prev?.spend ?? null,
        previousPeriodSales: prev?.sales ?? null,
    };
}

/**
 * Generate recommendation for a campaign based on analysis
 */
function generateRecommendation(analysis: CampaignAnalysis): Recommendation {
    const { campaignName, status, currentBudget, currentSpend, currentSales, currentRoas, estimatedProfit, trendVsPrevious, storeId } = analysis;

    // Default recommendation
    let rec: Partial<Recommendation> = {
        storeId,
        campaignSnapshotId: analysis.id,
        confidence: 0.5,
        risk: 'medium' as const,
    };

    const spend = currentSpend ?? 0;
    const sales = currentSales ?? 0;
    const roas = currentRoas ?? 0;
    const budget = currentBudget ?? 0;
    const budgetIsEditable = hasPositiveBudget(currentBudget);

    // Classification logic
    if (spend === 0 && sales === 0) {
        // No data yet
        rec = {
            ...rec,
            recommendationType: 'INFO',
            currentSetting: status,
            proposedSetting: 'Monitor',
            expectedRoiImpact: null,
            expectedProfitImpact: null,
            confidence: 0.3,
            risk: 'low',
            reason: 'No campaign data available. Monitor for next period.',
            rollbackPlan: 'No action taken. No rollback needed.',
        };
    } else if (roas >= 3.0 && estimatedProfit > 0 && !budgetIsEditable) {
        rec = {
            ...rec,
            recommendationType: 'INFO',
            currentSetting: 'Budget unavailable in latest DoorDash pull',
            proposedSetting: 'CEO review required before budget change',
            expectedRoiImpact: null,
            expectedProfitImpact: estimatedProfit * 0.20,
            confidence: 0.65,
            risk: 'medium',
            reason: `Strong ROI (${roas.toFixed(1)}x) and positive profit ($${estimatedProfit.toFixed(2)}), but DoorDash did not expose the current budget. Do not auto-queue a $0 budget edit.`,
            rollbackPlan: 'No automated budget change queued. Review the campaign budget in DoorDash before approving an edit.',
        };
    } else if (roas >= 3.0 && estimatedProfit > 0) {
        // High ROI + high profit: increase budget
        const newBudget = Math.round(budget * 1.20 * 100) / 100;
        rec = {
            ...rec,
            recommendationType: 'INCREASE',
            currentSetting: `$${budget}/week`,
            proposedSetting: `$${newBudget}/week (20% increase)`,
            expectedRoiImpact: roas * 0.1,
            expectedProfitImpact: estimatedProfit * 0.20,
            confidence: 0.75,
            risk: 'low',
            reason: `Strong ROI (${roas.toFixed(1)}x) and positive profit ($${estimatedProfit.toFixed(2)}). Increasing budget to capture more revenue.`,
            rollbackPlan: `Revert budget to $${budget}/week within 48 hours if ROAS drops below 2.0x.`,
        };
    } else if (sales > 0 && estimatedProfit < 0) {
        // High sales + low/negative profit: decrease or pause
        rec = {
            ...rec,
            recommendationType: 'PAUSE',
            currentSetting: `Active, $${spend}/week spend`,
            proposedSetting: 'Pause',
            expectedRoiImpact: 0,
            expectedProfitImpact: Math.abs(estimatedProfit),
            confidence: 0.8,
            risk: 'low',
            reason: `Campaign is spending $${spend.toFixed(2)} but losing $${Math.abs(estimatedProfit).toFixed(2)} per period. Pause to stop bleed.`,
            rollbackPlan: `Resume campaign with original budget of $${budget}/week after reviewing cost structure.`,
        };
    } else if (roas >= 1.0 && roas < 2.0 && estimatedProfit <= 0 && !budgetIsEditable) {
        rec = {
            ...rec,
            recommendationType: 'INFO',
            currentSetting: 'Budget unavailable in latest DoorDash pull',
            proposedSetting: 'CEO review required before budget test',
            expectedRoiImpact: null,
            expectedProfitImpact: null,
            confidence: 0.45,
            risk: 'medium',
            reason: `Marginal ROAS (${roas.toFixed(1)}x), but the current budget is unavailable. Do not queue a budget test without a verified current value.`,
            rollbackPlan: 'No automated budget change queued. Review the campaign budget in DoorDash before approving a test.',
        };
    } else if (roas >= 1.0 && roas < 2.0 && estimatedProfit <= 0) {
        // Marginal performance: test with lower budget
        const testBudget = Math.round((budget || spend) * 0.60 * 100) / 100;
        rec = {
            ...rec,
            recommendationType: 'TEST',
            currentSetting: `$${budget}/week`,
            proposedSetting: `$${testBudget}/week (40% decrease for testing)`,
            expectedRoiImpact: null,
            expectedProfitImpact: null,
            confidence: 0.5,
            risk: 'medium',
            reason: `Marginal ROAS (${roas.toFixed(1)}x). Reducing budget by 40% to test if profitability improves at lower spend.`,
            rollbackPlan: `If test fails, pause campaign. If test succeeds, maintain $${testBudget}/week or gradually increase.`,
        };
    } else if (roas < 1.0 && spend > 50) {
        // Low sales + high spend: pause
        rec = {
            ...rec,
            recommendationType: 'PAUSE',
            currentSetting: `Active, ROAS ${roas.toFixed(1)}x`,
            proposedSetting: 'Pause',
            expectedRoiImpact: 0,
            expectedProfitImpact: Math.abs(estimatedProfit),
            confidence: 0.85,
            risk: 'low',
            reason: `Poor performance: ROAS ${roas.toFixed(1)}x with $${spend.toFixed(2)} spend. Campaign is losing money.`,
            rollbackPlan: `Only resume after reviewing targeting, menu items, and pricing. Re-test with 50% budget.`,
        };
    } else {
        // Keep current settings
        rec = {
            ...rec,
            recommendationType: 'KEEP',
            currentSetting: `${status}, $${budget}/week`,
            proposedSetting: 'Maintain current settings',
            expectedRoiImpact: 0,
            expectedProfitImpact: 0,
            confidence: 0.5,
            risk: 'low',
            reason: 'Campaign is performing within expected range. No change recommended.',
            rollbackPlan: 'No action taken. Continue monitoring.',
        };
    }

    // Adjust confidence based on trend
    if (trendVsPrevious === 'down' && rec.recommendationType === 'KEEP') {
        rec.confidence = Math.max(0.3, (rec.confidence ?? 0.5) - 0.15);
        rec.reason += ' Trend is declining - monitor closely next period.';
    }
    if (trendVsPrevious === 'up' && rec.recommendationType === 'INCREASE') {
        rec.confidence = Math.min(0.95, (rec.confidence ?? 0.5) + 0.1);
        rec.reason += ' Positive trend reinforces increase recommendation.';
    }

    return rec as Recommendation;
}

/**
 * Analyze campaigns for a store and generate recommendations.
 * Saves recommendations to database.
 */
export function analyzeStoreCampaigns(storeId: string): { analyses: CampaignAnalysis[]; recommendations: Recommendation[] } {
    const db = getDb();
    const rows = getLatestSnapshotRows(storeId);

    const analyses: CampaignAnalysis[] = [];
    const recommendations: Recommendation[] = [];

    for (const row of rows) {
        const snapshot: CampaignData = {
            id: row.id,
            storeId: row.store_id,
            campaignName: row.campaign_name,
            campaignType: row.campaign_type,
            status: row.status,
            budget: row.budget,
            spend: row.spend,
            sales: row.sales,
            orders: row.orders,
            roas: row.roas,
            startDate: row.start_date,
            endDate: row.end_date,
            currency: row.currency,
            rawData: row.raw_data,
        };

        const analysis = analyzeCampaign(snapshot, storeId);
        analyses.push(analysis);

        const recommendation = generateRecommendation(analysis);
        recommendation.id = uuidv4();
        recommendations.push(recommendation);

        const existing = db.prepare(`
            SELECT id, status FROM recommendations
            WHERE store_id = ?
            AND COALESCE(campaign_snapshot_id, '') = COALESCE(?, '')
            AND recommendation_type = ?
            AND proposed_setting = ?
            ORDER BY created_at DESC
            LIMIT 1
        `).get(
            recommendation.storeId,
            recommendation.campaignSnapshotId || '',
            recommendation.recommendationType,
            recommendation.proposedSetting,
        ) as any;

        if (existing) {
            recommendation.id = existing.id;
            recommendation.status = existing.status;
        } else {
            db.prepare(`
                INSERT INTO recommendations (id, store_id, campaign_snapshot_id, recommendation_type, current_setting, proposed_setting, expected_roi_impact, expected_profit_impact, confidence, risk, reason, rollback_plan, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
            `).run(
                recommendation.id,
                recommendation.storeId,
                recommendation.campaignSnapshotId,
                recommendation.recommendationType,
                recommendation.currentSetting,
                recommendation.proposedSetting,
                recommendation.expectedRoiImpact,
                recommendation.expectedProfitImpact,
                recommendation.confidence,
                recommendation.risk,
                recommendation.reason,
                recommendation.rollbackPlan,
            );
        }
    }

    return { analyses, recommendations };
}

/**
 * Get pending recommendations for all stores
 */
export function getPendingRecommendations(): any[] {
    const db = getDb();
    return db.prepare(`
        SELECT r.*, s.name as store_name 
        FROM recommendations r 
        JOIN stores s ON r.store_id = s.id 
        WHERE r.status = 'pending' 
        ORDER BY r.confidence DESC
    `).all() as any[];
}

/**
 * Update recommendation status (approved/rejected)
 */
export function updateRecommendationStatus(id: string, status: 'approved' | 'rejected'): boolean {
    const db = getDb();
    const result = db.prepare('UPDATE recommendations SET status = ? WHERE id = ?').run(status, id);
    return result.changes > 0;
}
