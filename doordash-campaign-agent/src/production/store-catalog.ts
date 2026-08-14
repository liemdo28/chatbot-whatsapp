import type { ProductionStore } from './types.js';

const PRODUCTION_STORES: ProductionStore[] = [
    { id: 'bakudan-the-rim', name: 'Demo Ramen North', email: 'bakudan.rim@example.com', doorDashAccountId: '900002', active: true },
    { id: 'bakudan-stone-oak', name: 'Demo Ramen Central', email: 'bakudan.central@example.com', doorDashAccountId: '900003', active: true },
    { id: 'bakudan-bandera', name: 'Demo Ramen South', email: 'bakudan.south@example.com', doorDashAccountId: '900004', active: true },
    { id: 'raw-sushi-bar', name: 'Raw Sushi Bar', email: 'raw.sushi@example.com', doorDashAccountId: '892006', active: true },
];

export function configuredProductionStores(): ProductionStore[] {
    return PRODUCTION_STORES.map(store => ({ ...store }));
}

export function configuredProductionStoreMap(): Map<string, ProductionStore> {
    return new Map(configuredProductionStores().map(store => [store.id, store]));
}

export function resolveConfiguredProductionStore(storeId: string): ProductionStore | null {
    return configuredProductionStoreMap().get(storeId) || null;
}

export function validateProductionStoreCatalog(): ProductionStore[] {
    const stores = configuredProductionStores();
    const ids = new Set<string>();
    const accountIds = new Set<string>();

    for (const store of stores) {
        if (!store.id || !store.name || !store.email || !store.doorDashAccountId) {
            throw new Error(`Production store catalog entry ${store.id || '<missing-id>'} is incomplete.`);
        }
        if (ids.has(store.id)) {
            throw new Error(`Duplicate production store id ${store.id}.`);
        }
        if (accountIds.has(store.doorDashAccountId)) {
            throw new Error(`Duplicate DoorDash store id ${store.doorDashAccountId}.`);
        }
        ids.add(store.id);
        accountIds.add(store.doorDashAccountId);
    }

    const rawSushiBar = stores.find(store => store.id === 'raw-sushi-bar');
    if (!rawSushiBar || rawSushiBar.doorDashAccountId !== '892006') {
        throw new Error('raw-sushi-bar must map to DoorDash Store ID 892006.');
    }

    return stores;
}
