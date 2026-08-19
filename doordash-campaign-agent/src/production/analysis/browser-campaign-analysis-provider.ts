import type { CampaignAnalysisInput, ProviderCampaignAnalysisResult } from '../types.js';
import type { CampaignAnalysisProvider } from './provider.js';

export class BrowserCampaignAnalysisProvider implements CampaignAnalysisProvider {
    readonly providerName = 'browser';
    readonly providerModel = 'development-browser';

    async analyzeCampaign(_input: CampaignAnalysisInput): Promise<ProviderCampaignAnalysisResult> {
        throw new Error('BrowserCampaignAnalysisProvider is development-only and is rejected from the production workflow.');
    }
}
