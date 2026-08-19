import type { ParsedMarketingCampaign } from './marketing-report-parser.js';

export interface MarketingReportStoreMatcher {
    id: string;
    name?: string | null;
    doorDashAccountId?: string | null;
}

function normalizeValue(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function slugify(value: string | null | undefined): string {
    return normalizeValue(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function campaignMatchesStore(campaign: ParsedMarketingCampaign, store: MarketingReportStoreMatcher): boolean {
    const candidates = new Set([
        normalizeValue(store.id),
        normalizeValue(store.name),
        normalizeValue(store.doorDashAccountId),
        slugify(store.name),
    ].filter(Boolean));

    const campaignValues = [
        normalizeValue(campaign.storeId),
        normalizeValue(campaign.storeName),
        slugify(campaign.storeName),
    ].filter(Boolean);

    return campaignValues.some(value => candidates.has(value));
}
