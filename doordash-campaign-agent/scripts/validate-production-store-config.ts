import assert from 'node:assert/strict';
import { readProductionWorkflowConfig } from '../src/production/config.js';
import { sanitizeErrorMessage } from '../src/production/security/error-sanitizer.js';
import { validateProductionStoreCatalog } from '../src/production/store-catalog.js';
import { createProductionStorage } from '../src/production/storage/storage-factory.js';

(async () => {
    const config = readProductionWorkflowConfig();
    const expectedStores = validateProductionStoreCatalog();

    if (config.storageBackend === 'postgres' && !config.postgresDatabaseUrl) {
        throw new Error('DATABASE_URL is required when DD_STORAGE_BACKEND=postgres.');
    }

    const storage = createProductionStorage(config);
    await storage.initialize();
    try {
        const actualStores = await storage.listActiveStores(expectedStores.map(store => store.id));
        assert.equal(actualStores.length, expectedStores.length, 'Configured stores were not fully bootstrapped into storage.');

        for (const expected of expectedStores) {
            const actual = actualStores.find(store => store.id === expected.id);
            assert.ok(actual, `Store ${expected.id} is missing from storage.`);
            assert.equal(actual.doorDashAccountId, expected.doorDashAccountId, `Store ${expected.id} has the wrong DoorDash Store ID.`);
            assert.equal(actual.email, expected.email, `Store ${expected.id} has the wrong reporting mailbox.`);
        }

        console.log(`production-store-config validation passed for ${expectedStores.length} stores`);
    } finally {
        await storage.close();
    }
})().catch((error) => {
    console.error(sanitizeErrorMessage(error));
    process.exit(1);
});
