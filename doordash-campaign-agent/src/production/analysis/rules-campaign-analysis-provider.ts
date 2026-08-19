import { calculateCampaignMetrics, metricsToSupportingMetrics } from './campaign-metrics.js';
import type {
    CampaignAnalysisInput,
    ProviderCampaignAnalysisResult,
    ProviderRecommendation,
    RecommendationAction,
    RecommendationSeverity,
} from '../types.js';
import type { CampaignAnalysisProvider } from './provider.js';

function round(value: number, digits: number = 2): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function humanApprovalRequired(action: RecommendationAction): boolean {
    return !['KEEP', 'REQUEST_MORE_DATA'].includes(action);
}

function riskForSeverity(severity: RecommendationSeverity): 'low' | 'medium' | 'high' {
    if (severity === 'critical' || severity === 'high') {
        return 'high';
    }
    if (severity === 'medium') {
        return 'medium';
    }
    return 'low';
}

function buildRecommendation(input: CampaignAnalysisInput, partial: Omit<ProviderRecommendation, 'ruleVersion' | 'humanApprovalRequired' | 'missingData' | 'enrichmentStatus' | 'enrichmentNotes'> & { missingData?: string[] }): ProviderRecommendation {
    return {
        ...partial,
        ruleVersion: input.rules.ruleVersion,
        humanApprovalRequired: humanApprovalRequired(partial.recommendationType),
        missingData: [...(partial.missingData || [])].sort(),
        enrichmentStatus: 'not_applicable',
        enrichmentNotes: null,
    };
}

export class RulesCampaignAnalysisProvider implements CampaignAnalysisProvider {
    readonly providerName = 'rules';
    readonly providerModel: string;

    constructor(ruleVersion: string) {
        this.providerModel = ruleVersion;
    }

    async analyzeCampaign(input: CampaignAnalysisInput): Promise<ProviderCampaignAnalysisResult> {
        const metrics = calculateCampaignMetrics({
            snapshot: input.snapshot,
            previousSnapshot: input.previousSnapshot,
            storeTotals: input.storeWeeklyTotals,
        });
        const supportingMetrics = metricsToSupportingMetrics(metrics);
        const recommendations: ProviderRecommendation[] = [];
        const sampleAdequate = metrics.spend >= input.rules.minimumSpendForJudgement
            && (metrics.impressions === null || metrics.impressions >= input.rules.minimumImpressionsForConfidence)
            && (metrics.clicks === null || metrics.clicks >= input.rules.minimumClicksForConfidence);

        if (metrics.incompleteData) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'incomplete-data',
                recommendationType: 'REQUEST_MORE_DATA',
                severity: 'high',
                detectedCondition: 'Report data is incomplete for a safe optimization decision.',
                currentSetting: `${input.snapshot.status} | incomplete weekly report`,
                proposedSetting: 'Hold changes and request a complete weekly report before acting.',
                supportingMetrics,
                expectedBenefit: 'Prevents scaling or pausing a campaign from partial data.',
                expectedRoiImpact: null,
                expectedProfitImpact: null,
                confidence: 0.92,
                risk: 'high',
                reason: 'The report completeness guardrail blocked optimization because the weekly dataset is incomplete.',
                rollbackPlan: 'No campaign change is recommended.',
                missingData: metrics.missingData,
            }));
        }

        if (!sampleAdequate) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'insufficient-sample',
                recommendationType: 'REQUEST_MORE_DATA',
                severity: 'low',
                detectedCondition: 'Campaign does not have enough spend or traffic for a confident decision.',
                currentSetting: `${input.snapshot.status} | Spend ${round(metrics.spend)} ${input.rules.storeCurrency}`,
                proposedSetting: 'Collect more data before increasing, decreasing, or pausing this campaign.',
                supportingMetrics,
                expectedBenefit: 'Reduces false positives from tiny samples.',
                expectedRoiImpact: null,
                expectedProfitImpact: null,
                confidence: 0.78,
                risk: 'low',
                reason: 'Traffic and spend are below the confidence thresholds, so optimization is deferred.',
                rollbackPlan: 'No campaign change is recommended.',
                missingData: metrics.missingData,
            }));
        }

        if (sampleAdequate && metrics.sales <= 0 && metrics.orders <= 0 && metrics.spend >= input.rules.minimumSpendForJudgement) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'zero-sales-meaningful-spend',
                recommendationType: 'PAUSE',
                severity: 'critical',
                detectedCondition: 'Campaign spent meaningful budget without attributed sales or orders.',
                currentSetting: `${input.snapshot.status} | Spend ${round(metrics.spend)} ${input.rules.storeCurrency} | Sales 0`,
                proposedSetting: 'Pause the campaign pending a manual creative and targeting review.',
                supportingMetrics,
                expectedBenefit: 'Stops further waste from a campaign with no attributed return.',
                expectedRoiImpact: -1,
                expectedProfitImpact: round(-metrics.spend),
                confidence: 0.94,
                risk: 'high',
                reason: 'Meaningful spend with zero sales is a direct waste signal after the minimum sample threshold was met.',
                rollbackPlan: 'Resume only after validating tracking, offer quality, and targeting.',
                missingData: metrics.missingData,
            }));
        }

        if (sampleAdequate && metrics.roas !== null && metrics.roas < input.rules.minAcceptableRoas) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'roas-below-target',
                recommendationType: 'DECREASE',
                severity: metrics.roas < input.rules.minAcceptableRoas * 0.6 ? 'high' : 'medium',
                detectedCondition: `ROAS is below the minimum target of ${input.rules.minAcceptableRoas.toFixed(2)}x.`,
                currentSetting: `${input.snapshot.status} | ROAS ${metrics.roas.toFixed(2)}x`,
                proposedSetting: 'Reduce spend and review placement, creative, and offer fit before scaling again.',
                supportingMetrics,
                expectedBenefit: 'Improves capital efficiency by reallocating budget away from underperforming spend.',
                expectedRoiImpact: round(metrics.roas - input.rules.minAcceptableRoas, 2),
                expectedProfitImpact: round(input.estimatedProfit),
                confidence: 0.86,
                risk: 'medium',
                reason: 'The campaign is below the configured ROAS floor after clearing minimum sample thresholds.',
                rollbackPlan: 'Restore prior budget only after a later weekly report recovers above target.',
                missingData: metrics.missingData,
            }));
        }

        if (sampleAdequate && metrics.cpa !== null && metrics.cpa > input.rules.maxAcceptableCpa) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'cpa-above-target',
                recommendationType: 'DECREASE',
                severity: metrics.cpa > input.rules.maxAcceptableCpa * 1.5 ? 'high' : 'medium',
                detectedCondition: `CPA is above the maximum target of ${input.rules.maxAcceptableCpa.toFixed(2)} ${input.rules.storeCurrency}.`,
                currentSetting: `${input.snapshot.status} | CPA ${metrics.cpa.toFixed(2)} ${input.rules.storeCurrency}`,
                proposedSetting: 'Reduce spend and tighten targeting until acquisition cost returns to target.',
                supportingMetrics,
                expectedBenefit: 'Protects contribution margin by reducing expensive acquisition.',
                expectedRoiImpact: null,
                expectedProfitImpact: round(input.estimatedProfit),
                confidence: 0.84,
                risk: 'medium',
                reason: 'Cost per acquired order is above the configured ceiling on a sufficient sample.',
                rollbackPlan: 'Restore the prior budget only after later weeks bring CPA back within target.',
                missingData: metrics.missingData,
            }));
        }

        if (
            sampleAdequate
            && metrics.wowSpendPct !== null
            && metrics.wowSalesPct !== null
            && metrics.wowSpendPct > input.rules.deteriorationThresholdPct
            && metrics.wowSalesPct < -input.rules.deteriorationThresholdPct
        ) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'spend-up-sales-down',
                recommendationType: 'DECREASE',
                severity: 'high',
                detectedCondition: 'Spend increased week over week while attributed sales declined.',
                currentSetting: `${input.snapshot.status} | WoW spend ${round(metrics.wowSpendPct * 100)}% | WoW sales ${round((metrics.wowSalesPct || 0) * 100)}%`,
                proposedSetting: 'Reduce spend and review targeting drift before the next cycle.',
                supportingMetrics,
                expectedBenefit: 'Limits deterioration when incremental spend is not producing incremental sales.',
                expectedRoiImpact: metrics.wowRoasAbsolute,
                expectedProfitImpact: round(input.estimatedProfit),
                confidence: 0.88,
                risk: 'high',
                reason: 'Spend growth is outrunning demand generation, indicating deteriorating efficiency.',
                rollbackPlan: 'Return to the previous budget only after a later report reverses the trend.',
                missingData: metrics.missingData,
            }));
        }

        if (
            sampleAdequate
            && metrics.wowRoasPct !== null
            && metrics.wowRoasPct <= -input.rules.deteriorationThresholdPct
        ) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'week-over-week-deterioration',
                recommendationType: 'TEST',
                severity: 'medium',
                detectedCondition: 'Campaign efficiency deteriorated versus the previous completed week.',
                currentSetting: `${input.snapshot.status} | WoW ROAS ${round((metrics.wowRoasPct || 0) * 100)}%`,
                proposedSetting: 'Run a manual creative or targeting test before considering additional budget.',
                supportingMetrics,
                expectedBenefit: 'Encourages diagnosis before more spend is committed to a declining campaign.',
                expectedRoiImpact: metrics.wowRoasAbsolute,
                expectedProfitImpact: round(input.estimatedProfit),
                confidence: 0.8,
                risk: 'medium',
                reason: 'The week-over-week ROAS decline exceeded the configured deterioration threshold.',
                rollbackPlan: 'Keep the current budget if no test is approved.',
                missingData: metrics.missingData,
            }));
        }

        if (sampleAdequate && metrics.impressions !== null && metrics.ctr !== null && metrics.impressions >= input.rules.minimumImpressionsForConfidence && metrics.ctr < 0.005) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'low-ctr',
                recommendationType: 'TEST',
                severity: 'medium',
                detectedCondition: 'Campaign has impressions but very low click-through rate.',
                currentSetting: `${input.snapshot.status} | CTR ${round(metrics.ctr * 100, 2)}%`,
                proposedSetting: 'Test creative, headline, and audience adjustments to improve click-through rate.',
                supportingMetrics,
                expectedBenefit: 'Higher click-through rate can improve traffic quality without immediately increasing budget.',
                expectedRoiImpact: null,
                expectedProfitImpact: round(input.estimatedProfit),
                confidence: 0.76,
                risk: 'medium',
                reason: 'The campaign is being seen but is not attracting enough clicks to support efficient scaling.',
                rollbackPlan: 'If no test is approved, keep the current settings and re-evaluate next week.',
                missingData: metrics.missingData,
            }));
        }

        if (sampleAdequate && metrics.clicks !== null && metrics.conversionRate !== null && metrics.clicks >= input.rules.minimumClicksForConfidence && metrics.conversionRate < 0.03) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'low-conversion-rate',
                recommendationType: 'TEST',
                severity: 'medium',
                detectedCondition: 'Campaign is generating clicks but too few orders.',
                currentSetting: `${input.snapshot.status} | Conversion ${(metrics.conversionRate * 100).toFixed(2)}%`,
                proposedSetting: 'Test landing offer quality and targeting alignment before raising budget.',
                supportingMetrics,
                expectedBenefit: 'Improves downstream efficiency instead of scaling weak conversion traffic.',
                expectedRoiImpact: null,
                expectedProfitImpact: round(input.estimatedProfit),
                confidence: 0.77,
                risk: 'medium',
                reason: 'Click volume is present, but conversion is below a healthy baseline for confident scaling.',
                rollbackPlan: 'If no test is approved, maintain the current budget and monitor another full week.',
                missingData: metrics.missingData,
            }));
        }

        if (
            !metrics.incompleteData
            && sampleAdequate
            && metrics.roas !== null
            && metrics.roas >= input.rules.minAcceptableRoas * 1.3
            && metrics.spend > 0
            && (metrics.spendShareOfStore === null || metrics.spendShareOfStore < 0.35)
        ) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'strong-roas-limited-spend',
                recommendationType: 'INCREASE',
                severity: 'low',
                detectedCondition: 'Campaign shows strong ROAS with room to scale cautiously.',
                currentSetting: `${input.snapshot.status} | ROAS ${metrics.roas.toFixed(2)}x | Spend share ${round((metrics.spendShareOfStore || 0) * 100)}%`,
                proposedSetting: `Consider a manual budget increase capped at ${(input.rules.budgetIncreaseCeilingPct * 100).toFixed(0)}% for the next week.`,
                supportingMetrics,
                expectedBenefit: 'Captures incremental profitable demand while keeping scale within a safe ceiling.',
                expectedRoiImpact: round(metrics.roas - input.rules.minAcceptableRoas, 2),
                expectedProfitImpact: round(input.estimatedProfit),
                confidence: 0.83,
                risk: 'low',
                reason: 'The campaign is above the ROAS threshold and is not yet dominating store spend, so controlled scaling is justified.',
                rollbackPlan: 'Revert to the prior budget if the next completed week falls below target ROAS.',
                missingData: metrics.missingData,
            }));
        }

        if (recommendations.length === 0) {
            recommendations.push(buildRecommendation(input, {
                ruleId: 'performing-within-guardrails',
                recommendationType: 'KEEP',
                severity: 'low',
                detectedCondition: 'Campaign performance is within the configured guardrails.',
                currentSetting: `${input.snapshot.status} | Spend ${round(metrics.spend)} ${input.rules.storeCurrency} | ROAS ${(metrics.roas || 0).toFixed(2)}x`,
                proposedSetting: 'Keep the current settings and continue monitoring weekly performance.',
                supportingMetrics,
                expectedBenefit: 'Avoids unnecessary changes when performance is stable.',
                expectedRoiImpact: null,
                expectedProfitImpact: round(input.estimatedProfit),
                confidence: 0.7,
                risk: 'low',
                reason: 'No negative or scale-worthy rule fired after applying the configured thresholds and guardrails.',
                rollbackPlan: 'No rollback required.',
                missingData: metrics.missingData,
            }));
        }

        recommendations.sort((left, right) => {
            const weight = { critical: 4, high: 3, medium: 2, low: 1 };
            const severityDelta = weight[right.severity] - weight[left.severity];
            if (severityDelta !== 0) {
                return severityDelta;
            }
            return left.ruleId.localeCompare(right.ruleId);
        });

        return {
            provider: 'rules',
            model: this.providerModel,
            recommendations: recommendations.map(recommendation => ({
                ...recommendation,
                risk: riskForSeverity(recommendation.severity),
            })),
            questions: recommendations
                .flatMap(recommendation => recommendation.missingData)
                .filter((value, index, array) => array.indexOf(value) === index)
                .map(metric => `Can the weekly export provide reliable ${metric} for this campaign?`),
            summary: `Generated ${recommendations.length} deterministic rule-based recommendation(s).`,
        };
    }
}
