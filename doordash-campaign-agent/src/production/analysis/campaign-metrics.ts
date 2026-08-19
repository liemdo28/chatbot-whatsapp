import type { SupportingMetrics, WeeklyCampaignSnapshot } from '../types.js';

export interface CalculatedCampaignMetrics {
    spend: number;
    sales: number;
    orders: number;
    roas: number | null;
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    conversionRate: number | null;
    cpc: number | null;
    cpa: number | null;
    spendShareOfStore: number | null;
    salesShareOfStore: number | null;
    wowSpendAbsolute: number | null;
    wowSpendPct: number | null;
    wowSalesAbsolute: number | null;
    wowSalesPct: number | null;
    wowOrdersAbsolute: number | null;
    wowOrdersPct: number | null;
    wowRoasAbsolute: number | null;
    wowRoasPct: number | null;
    incompleteData: boolean;
    missingData: string[];
}

function round(value: number, digits: number = 4): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function safeRatio(numerator: number | null, denominator: number | null, digits: number = 4): number | null {
    if (numerator === null || denominator === null || denominator === 0) {
        return null;
    }
    return round(numerator / denominator, digits);
}

function safeDeltaPct(current: number | null, previous: number | null): number | null {
    if (current === null || previous === null || previous === 0) {
        return null;
    }
    return round((current - previous) / previous, 4);
}

function parseRawCampaign(snapshot: WeeklyCampaignSnapshot): Record<string, unknown> {
    try {
        const parsed = JSON.parse(snapshot.rawDataJson) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && parsed['campaign'] && typeof parsed['campaign'] === 'object') {
            return parsed['campaign'] as Record<string, unknown>;
        }
    } catch {
        return {};
    }
    return {};
}

function readOptionalNumber(record: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value.replace(/,/g, '').trim());
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return null;
}

export function calculateCampaignMetrics(input: {
    snapshot: WeeklyCampaignSnapshot;
    previousSnapshot: WeeklyCampaignSnapshot | null;
    storeTotals?: { spend: number; sales: number; orders: number };
}): CalculatedCampaignMetrics {
    const raw = parseRawCampaign(input.snapshot);
    const previousRaw = input.previousSnapshot ? parseRawCampaign(input.previousSnapshot) : {};

    const impressions = readOptionalNumber(raw, ['impressions', 'Impressions']);
    const clicks = readOptionalNumber(raw, ['clicks', 'Clicks']);
    const previousImpressions = readOptionalNumber(previousRaw, ['impressions', 'Impressions']);
    const previousClicks = readOptionalNumber(previousRaw, ['clicks', 'Clicks']);
    const ctr = safeRatio(clicks, impressions);
    const conversionRate = safeRatio(input.snapshot.orders, clicks);
    const cpc = safeRatio(input.snapshot.spend, clicks, 2);
    const cpa = safeRatio(input.snapshot.spend, input.snapshot.orders, 2);
    const roas = input.snapshot.spend > 0 ? round(input.snapshot.sales / input.snapshot.spend, 2) : null;
    const previousRoas = input.previousSnapshot && input.previousSnapshot.spend > 0
        ? round(input.previousSnapshot.sales / input.previousSnapshot.spend, 2)
        : null;

    const missingData: string[] = [];
    if (impressions === null) {
        missingData.push('impressions');
    }
    if (clicks === null) {
        missingData.push('clicks');
    }
    if (ctr === null) {
        missingData.push('ctr');
    }
    if (conversionRate === null) {
        missingData.push('conversionRate');
    }
    if (cpc === null) {
        missingData.push('cpc');
    }
    if (cpa === null) {
        missingData.push('cpa');
    }
    if (input.snapshot.dataCompleteness < 4) {
        missingData.push('dataCompleteness');
    }

    return {
        spend: input.snapshot.spend,
        sales: input.snapshot.sales,
        orders: input.snapshot.orders,
        roas,
        impressions,
        clicks,
        ctr,
        conversionRate,
        cpc,
        cpa,
        spendShareOfStore: safeRatio(input.snapshot.spend, input.storeTotals?.spend ?? null),
        salesShareOfStore: safeRatio(input.snapshot.sales, input.storeTotals?.sales ?? null),
        wowSpendAbsolute: input.previousSnapshot ? round(input.snapshot.spend - input.previousSnapshot.spend, 2) : null,
        wowSpendPct: input.previousSnapshot ? safeDeltaPct(input.snapshot.spend, input.previousSnapshot.spend) : null,
        wowSalesAbsolute: input.previousSnapshot ? round(input.snapshot.sales - input.previousSnapshot.sales, 2) : null,
        wowSalesPct: input.previousSnapshot ? safeDeltaPct(input.snapshot.sales, input.previousSnapshot.sales) : null,
        wowOrdersAbsolute: input.previousSnapshot ? input.snapshot.orders - input.previousSnapshot.orders : null,
        wowOrdersPct: input.previousSnapshot ? safeDeltaPct(input.snapshot.orders, input.previousSnapshot.orders) : null,
        wowRoasAbsolute: input.previousSnapshot && roas !== null && previousRoas !== null ? round(roas - previousRoas, 2) : null,
        wowRoasPct: input.previousSnapshot ? safeDeltaPct(roas, previousRoas) : null,
        incompleteData: input.snapshot.dataCompleteness < 4 || input.snapshot.observedDateStart !== input.snapshot.weekStart,
        missingData,
    };
}

export function metricsToSupportingMetrics(metrics: CalculatedCampaignMetrics): SupportingMetrics {
    return {
        spend: metrics.spend,
        sales: metrics.sales,
        orders: metrics.orders,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        ctr: metrics.ctr,
        conversionRate: metrics.conversionRate,
        cpc: metrics.cpc,
        cpa: metrics.cpa,
        roas: metrics.roas,
        spendShareOfStore: metrics.spendShareOfStore,
        salesShareOfStore: metrics.salesShareOfStore,
        wowSpendAbsolute: metrics.wowSpendAbsolute,
        wowSpendPct: metrics.wowSpendPct,
        wowSalesAbsolute: metrics.wowSalesAbsolute,
        wowSalesPct: metrics.wowSalesPct,
        wowOrdersAbsolute: metrics.wowOrdersAbsolute,
        wowOrdersPct: metrics.wowOrdersPct,
        wowRoasAbsolute: metrics.wowRoasAbsolute,
        wowRoasPct: metrics.wowRoasPct,
        incompleteData: metrics.incompleteData,
    };
}
