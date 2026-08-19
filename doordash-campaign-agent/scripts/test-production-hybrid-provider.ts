import assert from 'node:assert/strict';
import type { CampaignAnalysisInput, ProductionStore, WeeklyCampaignSnapshot } from '../src/production/types.js';
import { HybridCampaignAnalysisProvider } from '../src/production/analysis/hybrid-campaign-analysis-provider.js';

const store: ProductionStore = {
    id: 'raw-sushi-bar',
    name: 'Raw Sushi Bar',
    email: 'raw@example.com',
    doorDashAccountId: '892006',
    active: true,
};

const snapshot: WeeklyCampaignSnapshot = {
    id: 'snapshot-1',
    storeId: 'raw-sushi-bar',
    campaignId: 'campaign-1',
    campaignName: 'Smart campaign',
    campaignType: 'promotion',
    status: 'active',
    weekStart: '2026-07-13',
    weekEndExclusive: '2026-07-20',
    snapshotSource: 'email_export',
    sourceRef: 'fixture.zip',
    batchId: 'batch-1',
    reportStartDate: '07/13/2026',
    reportEndDate: '07/20/2026',
    observedDateStart: '2026-07-13',
    observedDateEnd: '2026-07-19',
    orders: 0,
    sales: 0,
    spend: 90,
    roas: 0,
    startDate: '2026-06-24',
    endDate: null,
    dataCompleteness: 4,
    rawDataJson: JSON.stringify({ campaign: { campaignId: 'campaign-1', campaignName: 'Smart campaign', impressions: 5000, clicks: 150 } }),
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
};

const input: CampaignAnalysisInput = {
    store,
    snapshot,
    currentBudget: null,
    estimatedProfit: -90,
    estimatedMargin: 0,
    previousSnapshot: null,
    rules: {
        ruleVersion: 'rules-v1',
        minAcceptableRoas: 3,
        maxAcceptableCpa: 25,
        minimumSpendForJudgement: 25,
        minimumImpressionsForConfidence: 1000,
        minimumClicksForConfidence: 25,
        deteriorationThresholdPct: 0.2,
        budgetIncreaseCeilingPct: 0.2,
        storeCurrency: 'USD',
        storeTimeZone: 'America/Los_Angeles',
    },
    storeWeeklyTotals: {
        spend: 200,
        sales: 300,
        orders: 10,
    },
};

(async () => {
    const providerWithoutKey = new HybridCampaignAnalysisProvider({ ruleVersion: 'rules-v1' });
    const fallback = await providerWithoutKey.analyzeCampaign(input);
    assert.equal(fallback.provider, 'hybrid');
    assert.ok(fallback.recommendations.length > 0);
    assert.ok(fallback.recommendations.every(recommendation => recommendation.enrichmentStatus === 'skipped'));

    console.log('production-hybrid tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
