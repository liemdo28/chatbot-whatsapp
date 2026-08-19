import type { CampaignAnalysisInput, ProviderRecommendation } from '../types.js';

export interface CampaignAnalysisProvider {
    readonly providerName: string;
    analyzeCampaign(input: CampaignAnalysisInput): Promise<ProviderRecommendation>;
}
