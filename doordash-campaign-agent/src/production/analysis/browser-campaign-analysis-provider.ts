import type { CampaignAnalysisInput, ProviderRecommendation } from '../types.js';
import type { CampaignAnalysisProvider } from './provider.js';

export class BrowserCampaignAnalysisProvider implements CampaignAnalysisProvider {
    readonly providerName = 'browser';

    async analyzeCampaign(_input: CampaignAnalysisInput): Promise<ProviderRecommendation> {
        throw new Error('BrowserCampaignAnalysisProvider is development-only and is rejected from the production workflow.');
    }
}
