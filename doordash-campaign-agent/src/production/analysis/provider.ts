import type { CampaignAnalysisInput, ProviderCampaignAnalysisResult } from '../types.js';

export interface CampaignAnalysisProvider {
    readonly providerName: string;
    readonly providerModel: string;
    analyzeCampaign(input: CampaignAnalysisInput): Promise<ProviderCampaignAnalysisResult>;
}
