import { ProductionWorkflowConfig } from '../config.js';
import type { ProductionStorage } from './production-storage.js';
import { PostgresProductionStorage } from './postgres-production-storage.js';
import { resolveProductionPostgresTlsConfig } from './postgres-tls.js';
import { SqliteProductionStorage } from './sqlite-production-storage.js';

export function createProductionStorage(config: ProductionWorkflowConfig): ProductionStorage {
    return config.storageBackend === 'postgres'
        ? new PostgresProductionStorage(config.postgresDatabaseUrl, {
            ssl: resolveProductionPostgresTlsConfig(config),
        })
        : new SqliteProductionStorage(config.sqliteDbPath);
}
