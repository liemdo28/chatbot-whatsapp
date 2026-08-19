import assert from 'node:assert/strict';
import { calculateCampaignMetrics } from '../src/production/analysis/campaign-metrics.js';
import { RulesCampaignAnalysisProvider } from '../src/production/analysis/rules-campaign-analysis-provider.js';
import type { CampaignAnalysisInput, ProductionStore, WeeklyCampaignSnapshot } from '../src/production/types.js';

const store: ProductionStore = {
    id: 'raw-sushi-bar',
    name: 'Raw Sushi Bar',
    email: 'raw@example.com',
    doorDashAccountId: '892006',
    active: true,
};

function buildSnapshot(overrides: Partial<WeeklyCampaignSnapshot> = {}, campaignOverrides: Record<string, unknown> = {}): WeeklyCampaignSnapshot {
    const baseCampaign = {
        campaignId: 'campaign-1',
        campaignName: 'Smart campaign',
        impressions: 5000,
        clicks: 150,
    };
    return {
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
        orders: 10,
        sales: 400,
        spend: 100,
        roas: 4,
        startDate: '2026-06-24',
        endDate: null,
        dataCompleteness: 4,
        rawDataJson: JSON.stringify({ campaign: { ...baseCampaign, ...campaignOverrides } }),
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
        ...overrides,
    };
}

function buildInput(snapshot: WeeklyCampaignSnapshot, previousSnapshot: WeeklyCampaignSnapshot | null = null): CampaignAnalysisInput {
    return {
        store,
        snapshot,
        currentBudget: null,
        estimatedProfit: (snapshot.sales * 0.2) - snapshot.spend,
        estimatedMargin: snapshot.sales > 0 ? 0.2 : 0,
        previousSnapshot,
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
            spend: 500,
            sales: 2000,
            orders: 40,
        },
    };
}

(async () => {
    const provider = new RulesCampaignAnalysisProvider('rules-v1');
    const metrics = calculateCampaignMetrics({
        snapshot: buildSnapshot({ sales: 240, spend: 80, orders: 6 }, { impressions: 4000, clicks: 80 }),
        previousSnapshot: buildSnapshot({ weekStart: '2026-07-06', weekEndExclusive: '2026-07-13', sales: 200, spend: 100, orders: 5 }, { impressions: 5000, clicks: 100 }),
        storeTotals: { spend: 500, sales: 2000, orders: 40 },
    });
    assert.equal(metrics.roas, 3);
    assert.equal(metrics.cpa, 13.33);
    assert.equal(metrics.ctr, 0.02);
    assert.equal(metrics.conversionRate, 0.075);

    const poorRoas = await provider.analyzeCampaign(buildInput(buildSnapshot({ sales: 120, spend: 100, orders: 3, roas: 1.2 })));
    assert.ok(poorRoas.recommendations.some(recommendation => recommendation.ruleId === 'roas-below-target'));

    const highCpa = await provider.analyzeCampaign(buildInput(buildSnapshot({ sales: 220, spend: 120, orders: 2, roas: 1.83 })));
    assert.ok(highCpa.recommendations.some(recommendation => recommendation.ruleId === 'cpa-above-target'));

    const zeroSales = await provider.analyzeCampaign(buildInput(buildSnapshot({ sales: 0, spend: 90, orders: 0, roas: 0 })));
    assert.ok(zeroSales.recommendations.some(recommendation => recommendation.ruleId === 'zero-sales-meaningful-spend'));

    const insufficientSample = await provider.analyzeCampaign(buildInput(buildSnapshot({ spend: 10, sales: 50, orders: 1, roas: 5 }, { impressions: 200, clicks: 5 })));
    assert.ok(insufficientSample.recommendations.some(recommendation => recommendation.ruleId === 'insufficient-sample'));

    const missingMetrics = await provider.analyzeCampaign(buildInput(buildSnapshot({}, { impressions: null, clicks: null })));
    assert.ok(missingMetrics.recommendations.some(recommendation => recommendation.missingData.includes('impressions')));
    const unavailableMetrics = calculateCampaignMetrics({
        snapshot: buildSnapshot({ orders: 0, spend: 0, sales: 0 }, { impressions: null, clicks: null }),
        previousSnapshot: null,
        storeTotals: { spend: 0, sales: 0, orders: 0 },
    });
    assert.equal(unavailableMetrics.ctr, null);
    assert.equal(unavailableMetrics.cpa, null);
    assert.equal(unavailableMetrics.conversionRate, null);

    const strongCampaign = await provider.analyzeCampaign(buildInput(buildSnapshot({ sales: 520, spend: 100, orders: 14, roas: 5.2 })));
    assert.ok(strongCampaign.recommendations.some(recommendation => recommendation.ruleId === 'strong-roas-limited-spend'));
    const scaleRecommendation = strongCampaign.recommendations.find(recommendation => recommendation.ruleId === 'strong-roas-limited-spend');
    assert.ok(scaleRecommendation);
    assert.equal(scaleRecommendation?.humanApprovalRequired, true);
    assert.equal(scaleRecommendation?.ruleVersion, 'rules-v1');
    assert.equal(typeof scaleRecommendation?.supportingMetrics['roas'], 'number');

    const previous = buildSnapshot({ sales: 300, spend: 80, orders: 10, roas: 3.75, weekStart: '2026-07-06', weekEndExclusive: '2026-07-13' });
    const deterioration = await provider.analyzeCampaign(buildInput(
        buildSnapshot({ sales: 180, spend: 120, orders: 6, roas: 1.5 }),
        previous,
    ));
    assert.ok(deterioration.recommendations.some(recommendation => recommendation.ruleId === 'week-over-week-deterioration'));

    const deterministicA = await provider.analyzeCampaign(buildInput(buildSnapshot({ sales: 150, spend: 100, orders: 4, roas: 1.5 })));
    const deterministicB = await provider.analyzeCampaign(buildInput(buildSnapshot({ sales: 150, spend: 100, orders: 4, roas: 1.5 })));
    assert.deepEqual(deterministicA, deterministicB);

    const incomplete = await provider.analyzeCampaign(buildInput(buildSnapshot({ dataCompleteness: 2, observedDateStart: '2026-07-14' })));
    assert.ok(incomplete.recommendations.some(recommendation => recommendation.ruleId === 'incomplete-data'));
    assert.equal(incomplete.recommendations.some(recommendation => recommendation.recommendationType === 'INCREASE'), false);

    const uniqueRuleIds = deterministicA.recommendations.map(recommendation => recommendation.ruleId);
    assert.equal(uniqueRuleIds.length, new Set(uniqueRuleIds).size);

    console.log('production-rules tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
