import type { CampaignAnalysisInput, ProviderCampaignAnalysisResult } from '../types.js';
import type { CampaignAnalysisProvider } from './provider.js';
import { OpenAiCampaignAnalysisProvider } from './openai-campaign-analysis-provider.js';
import { RulesCampaignAnalysisProvider } from './rules-campaign-analysis-provider.js';

export class HybridCampaignAnalysisProvider implements CampaignAnalysisProvider {
    readonly providerName = 'hybrid';
    readonly providerModel: string;
    private readonly rulesProvider: RulesCampaignAnalysisProvider;
    private readonly openAiProvider: OpenAiCampaignAnalysisProvider | null;

    constructor(input: {
        ruleVersion: string;
        apiKey?: string;
        model?: string;
    }) {
        this.rulesProvider = new RulesCampaignAnalysisProvider(input.ruleVersion);
        this.openAiProvider = input.apiKey
            ? new OpenAiCampaignAnalysisProvider({
                apiKey: input.apiKey,
                model: input.model || 'gpt-5-mini',
            })
            : null;
        this.providerModel = this.openAiProvider
            ? `${input.ruleVersion}+${input.model || 'gpt-5-mini'}`
            : `${input.ruleVersion}+openai-skipped`;
    }

    async analyzeCampaign(input: CampaignAnalysisInput): Promise<ProviderCampaignAnalysisResult> {
        const rulesResult = await this.rulesProvider.analyzeCampaign(input);
        if (!this.openAiProvider) {
            return {
                provider: 'hybrid',
                model: this.providerModel,
                recommendations: rulesResult.recommendations.map(recommendation => ({
                    ...recommendation,
                    enrichmentStatus: 'skipped',
                    enrichmentNotes: 'OpenAI enrichment was skipped because OPENAI_API_KEY is unavailable.',
                })),
                questions: rulesResult.questions,
                summary: `${rulesResult.summary} OpenAI enrichment skipped because no API key was configured.`,
            };
        }

        try {
            const openAiResult = await this.openAiProvider.analyzeCampaign(input);
            const openAiRecommendation = openAiResult.recommendations[0];
            return {
                provider: 'hybrid',
                model: this.providerModel,
                recommendations: rulesResult.recommendations.map(recommendation => ({
                    ...recommendation,
                    reason: `${recommendation.reason} OpenAI note: ${openAiRecommendation.reason}`,
                    expectedBenefit: `${recommendation.expectedBenefit} OpenAI note: ${openAiRecommendation.proposedSetting}.`,
                    enrichmentStatus: 'enriched',
                    enrichmentNotes: openAiRecommendation.reason,
                })),
                questions: [...rulesResult.questions, ...openAiResult.questions]
                    .filter((value, index, array) => array.indexOf(value) === index),
                summary: `${rulesResult.summary} OpenAI enrichment completed successfully.`,
            };
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'OpenAI enrichment failed.';
            return {
                provider: 'hybrid',
                model: this.providerModel,
                recommendations: rulesResult.recommendations.map(recommendation => ({
                    ...recommendation,
                    enrichmentStatus: 'skipped',
                    enrichmentNotes: `OpenAI enrichment skipped after a non-fatal error: ${reason}`,
                })),
                questions: rulesResult.questions,
                summary: `${rulesResult.summary} OpenAI enrichment was skipped after a non-fatal error.`,
            };
        }
    }
}
