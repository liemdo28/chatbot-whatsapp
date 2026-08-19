import type { ProductionStore, StoreVerificationStatus } from './types.js';

export interface SanitizedStoreCatalogRow {
    storeSlug: string;
    displayName: string;
    doorDashStoreId: string;
    timezone: string;
    currency: string;
    enabled: boolean;
    historicValidReport: 'YES' | 'NO' | 'UNKNOWN';
    expectedReportIdentity: string;
    mappingStatus: 'VERIFIED' | 'UNKNOWN';
    notes: string[];
}

function createStore(input: {
    storeSlug: string;
    displayName: string;
    doorDashStoreId: string | null;
    timezone: string;
    currency: string;
    enabled: boolean;
    reportSubjectAliases?: string[];
    reportFilenameAliases?: string[];
    expectedReportIdentity?: string | null;
    hasHistoricValidReport?: boolean | null;
    storeIdVerificationStatus?: StoreVerificationStatus;
    timezoneVerificationStatus?: StoreVerificationStatus;
    currencyVerificationStatus?: StoreVerificationStatus;
    expectedReportIdentityStatus?: StoreVerificationStatus;
    mappingNotes?: string[];
}): ProductionStore {
    return {
        id: input.storeSlug,
        name: input.displayName,
        email: 'central-mailbox@example.com',
        doorDashAccountId: input.doorDashStoreId,
        active: input.enabled,
        storeSlug: input.storeSlug,
        displayName: input.displayName,
        doorDashStoreId: input.doorDashStoreId,
        timezone: input.timezone,
        currency: input.currency,
        enabled: input.enabled,
        reportSubjectAliases: input.reportSubjectAliases || [],
        reportFilenameAliases: input.reportFilenameAliases || [],
        expectedReportIdentity: input.expectedReportIdentity || null,
        hasHistoricValidReport: input.hasHistoricValidReport ?? null,
        storeIdVerificationStatus: input.storeIdVerificationStatus || 'unknown',
        timezoneVerificationStatus: input.timezoneVerificationStatus || 'unknown',
        currencyVerificationStatus: input.currencyVerificationStatus || 'unknown',
        expectedReportIdentityStatus: input.expectedReportIdentityStatus || 'unknown',
        mappingNotes: input.mappingNotes || [],
    };
}

const PRODUCTION_STORES: ProductionStore[] = [
    createStore({
        storeSlug: 'bakudan-the-rim',
        displayName: 'Bakudan The Rim',
        doorDashStoreId: null,
        timezone: 'America/Los_Angeles',
        currency: 'USD',
        enabled: true,
        reportSubjectAliases: ['bakudan the rim'],
        reportFilenameAliases: ['bakudan-the-rim'],
        expectedReportIdentity: null,
        hasHistoricValidReport: true,
        storeIdVerificationStatus: 'unknown',
        timezoneVerificationStatus: 'assumed',
        currencyVerificationStatus: 'assumed',
        expectedReportIdentityStatus: 'unknown',
        mappingNotes: [
            'Display name is corroborated by legacy audit reports.',
            'The tracked weekly ZIP fixture is synthetic and does not prove a live production DoorDash Store ID.',
        ],
    }),
    createStore({
        storeSlug: 'bakudan-stone-oak',
        displayName: 'Bakudan Stone Oak',
        doorDashStoreId: null,
        timezone: 'America/Los_Angeles',
        currency: 'USD',
        enabled: true,
        reportSubjectAliases: ['bakudan stone oak'],
        reportFilenameAliases: ['bakudan-stone-oak'],
        expectedReportIdentity: null,
        hasHistoricValidReport: null,
        storeIdVerificationStatus: 'unknown',
        timezoneVerificationStatus: 'assumed',
        currencyVerificationStatus: 'assumed',
        expectedReportIdentityStatus: 'unknown',
        mappingNotes: [
            'Display name is corroborated by legacy audit reports.',
            'No historic supported weekly marketing report artifact is tracked in the repository for this store.',
        ],
    }),
    createStore({
        storeSlug: 'bakudan-bandera',
        displayName: 'Bakudan Bandera',
        doorDashStoreId: null,
        timezone: 'America/Los_Angeles',
        currency: 'USD',
        enabled: true,
        reportSubjectAliases: ['bakudan bandera'],
        reportFilenameAliases: ['bakudan-bandera'],
        expectedReportIdentity: null,
        hasHistoricValidReport: null,
        storeIdVerificationStatus: 'unknown',
        timezoneVerificationStatus: 'assumed',
        currencyVerificationStatus: 'assumed',
        expectedReportIdentityStatus: 'unknown',
        mappingNotes: [
            'Display name is corroborated by legacy audit reports.',
            'No historic supported weekly marketing report artifact is tracked in the repository for this store.',
        ],
    }),
    createStore({
        storeSlug: 'raw-sushi-bar',
        displayName: 'Raw Sushi Bar',
        doorDashStoreId: '892006',
        timezone: 'America/Los_Angeles',
        currency: 'USD',
        enabled: true,
        reportSubjectAliases: ['raw sushi bar'],
        reportFilenameAliases: ['raw-sushi-bar'],
        expectedReportIdentity: 'central-imap-mailbox',
        hasHistoricValidReport: true,
        storeIdVerificationStatus: 'verified',
        timezoneVerificationStatus: 'assumed',
        currencyVerificationStatus: 'assumed',
        expectedReportIdentityStatus: 'assumed',
        mappingNotes: [
            'DoorDash Store ID 892006 is corroborated by a tracked supported report fixture and legacy audit output.',
        ],
    }),
];

function cloneStore(store: ProductionStore): ProductionStore {
    return {
        ...store,
        reportSubjectAliases: [...store.reportSubjectAliases],
        reportFilenameAliases: [...store.reportFilenameAliases],
        mappingNotes: [...store.mappingNotes],
    };
}

function normalizeValue(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function mappingStatusForStore(store: ProductionStore): 'VERIFIED' | 'UNKNOWN' {
    return store.storeIdVerificationStatus === 'verified'
        && store.timezoneVerificationStatus === 'verified'
        && store.currencyVerificationStatus === 'verified'
        && store.expectedReportIdentityStatus === 'verified'
        ? 'VERIFIED'
        : 'UNKNOWN';
}

function unknownLabel(status: StoreVerificationStatus, value: string | null): string {
    return status === 'verified' && value ? value : 'UNKNOWN';
}

export function configuredProductionStores(): ProductionStore[] {
    return PRODUCTION_STORES.map(cloneStore);
}

export function configuredProductionStoreMap(): Map<string, ProductionStore> {
    return new Map(configuredProductionStores().map(store => [store.storeSlug, store]));
}

export function resolveConfiguredProductionStore(storeId: string): ProductionStore | null {
    return configuredProductionStoreMap().get(storeId) || null;
}

export function enabledProductionStores(storeIds?: string[]): ProductionStore[] {
    const requested = new Set((storeIds || []).map(normalizeValue).filter(Boolean));
    return configuredProductionStores().filter((store) => {
        if (!store.enabled) return false;
        return requested.size === 0 || requested.has(normalizeValue(store.storeSlug));
    });
}

export function validateProductionStoreCatalog(): ProductionStore[] {
    const stores = configuredProductionStores();
    const slugs = new Set<string>();
    const storeIds = new Set<string>();

    for (const store of stores) {
        if (!store.storeSlug || !store.displayName || !store.timezone || !store.currency) {
            throw new Error(`Production store catalog entry ${store.storeSlug || '<missing-slug>'} is incomplete.`);
        }
        if (store.id !== store.storeSlug) {
            throw new Error(`Production store catalog entry ${store.storeSlug} has an inconsistent slug.`);
        }
        if (store.name !== store.displayName) {
            throw new Error(`Production store catalog entry ${store.storeSlug} has an inconsistent display name.`);
        }
        if (slugs.has(store.storeSlug)) {
            throw new Error(`Duplicate production store slug ${store.storeSlug}.`);
        }
        slugs.add(store.storeSlug);

        if (store.doorDashStoreId) {
            if (storeIds.has(store.doorDashStoreId)) {
                throw new Error(`Duplicate DoorDash store id ${store.doorDashStoreId}.`);
            }
            storeIds.add(store.doorDashStoreId);
        }
    }

    const rawSushiBar = stores.find(store => store.storeSlug === 'raw-sushi-bar');
    if (!rawSushiBar || rawSushiBar.doorDashStoreId !== '892006') {
        throw new Error('raw-sushi-bar must map to DoorDash Store ID 892006.');
    }

    return stores;
}

export function unresolvedStoreMappings(stores: ProductionStore[]): Array<{ store: ProductionStore; issues: string[] }> {
    return stores.map((store) => {
        const issues: string[] = [];
        if (store.storeIdVerificationStatus !== 'verified' || !store.doorDashStoreId) {
            issues.push(`DoorDash Store ID is UNKNOWN for ${store.storeSlug}.`);
        }
        if (store.timezoneVerificationStatus !== 'verified') {
            issues.push(`Reporting timezone is UNKNOWN for ${store.storeSlug}.`);
        }
        if (store.currencyVerificationStatus !== 'verified') {
            issues.push(`Currency is UNKNOWN for ${store.storeSlug}.`);
        }
        if (store.expectedReportIdentityStatus !== 'verified') {
            issues.push(`Expected report/account identity is UNKNOWN for ${store.storeSlug}.`);
        }
        return { store, issues };
    }).filter(item => item.issues.length > 0);
}

export function assertStoresReadyForProductionRun(stores: ProductionStore[]): void {
    const unresolved = unresolvedStoreMappings(stores);
    if (unresolved.length === 0) {
        return;
    }
    const message = unresolved
        .map(item => `${item.store.storeSlug}: ${item.issues.join(' ')}`)
        .join(' | ');
    throw new Error(message);
}

export function sanitizeProductionStoreCatalogRows(stores: ProductionStore[] = configuredProductionStores()): SanitizedStoreCatalogRow[] {
    return stores.map(store => ({
        storeSlug: store.storeSlug,
        displayName: store.displayName,
        doorDashStoreId: unknownLabel(store.storeIdVerificationStatus, store.doorDashStoreId),
        timezone: unknownLabel(store.timezoneVerificationStatus, store.timezone),
        currency: unknownLabel(store.currencyVerificationStatus, store.currency),
        enabled: store.enabled,
        historicValidReport: store.hasHistoricValidReport === true ? 'YES' : store.hasHistoricValidReport === false ? 'NO' : 'UNKNOWN',
        expectedReportIdentity: unknownLabel(store.expectedReportIdentityStatus, store.expectedReportIdentity),
        mappingStatus: mappingStatusForStore(store),
        notes: [...store.mappingNotes],
    }));
}

export function hydrateProductionStore(row: Pick<ProductionStore, 'id' | 'name' | 'email' | 'doorDashAccountId' | 'active'>): ProductionStore {
    const configured = resolveConfiguredProductionStore(row.id);
    if (!configured) {
        return {
            ...createStore({
                storeSlug: row.id,
                displayName: row.name,
                doorDashStoreId: row.doorDashAccountId || null,
                timezone: 'America/Los_Angeles',
                currency: 'USD',
                enabled: row.active,
                mappingNotes: ['Runtime store exists in storage but is not present in the tracked production catalog.'],
            }),
            email: row.email,
        };
    }

    return {
        ...configured,
        id: row.id,
        name: row.name || configured.displayName,
        email: row.email || configured.email,
        doorDashAccountId: row.doorDashAccountId || configured.doorDashStoreId,
        doorDashStoreId: row.doorDashAccountId || configured.doorDashStoreId,
        active: row.active,
        enabled: row.active,
    };
}
