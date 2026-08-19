import fs from 'fs';
import type { PoolConfig } from 'pg';
import type { ProductionWorkflowConfig } from '../config.js';

const CERTIFICATE_BOUNDARY_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;
const SSL_QUERY_PARAM_NAMES = new Set([
    'ssl',
    'sslcert',
    'sslkey',
    'sslmode',
    'sslpassword',
    'sslrootcert',
]);

export interface PostgresTlsConfig {
    ca: string;
    rejectUnauthorized: true;
}

function stripWrappingQuotes(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\''))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

export function normalizeCertificatePem(rawValue: string): string {
    const trimmed = stripWrappingQuotes(String(rawValue || '').trim());
    if (!trimmed) {
        return '';
    }
    return `${trimmed
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim()}\n`;
}

export function validateCertificatePem(rawValue: string, sourceName: string): string {
    const normalized = normalizeCertificatePem(rawValue);
    if (!normalized) {
        throw new Error(`${sourceName} is required for production Postgres TLS.`);
    }
    if (!CERTIFICATE_BOUNDARY_PATTERN.test(normalized)) {
        throw new Error(`${sourceName} must contain a PEM certificate with BEGIN CERTIFICATE / END CERTIFICATE boundaries.`);
    }
    return normalized;
}

export function buildExplicitSslConnectionString(databaseUrl: string): string {
    try {
        const parsed = new URL(databaseUrl);
        for (const key of [...parsed.searchParams.keys()]) {
            if (SSL_QUERY_PARAM_NAMES.has(key.toLowerCase())) {
                parsed.searchParams.delete(key);
            }
        }
        return parsed.toString();
    } catch {
        return databaseUrl;
    }
}

export function resolveProductionPostgresTlsConfig(
    config: Pick<ProductionWorkflowConfig, 'executionEnv' | 'storageBackend' | 'postgresDatabaseCaCert' | 'postgresDatabaseCaCertPath'>,
    readFile: (filePath: string) => string = (filePath) => fs.readFileSync(filePath, 'utf8'),
): PostgresTlsConfig | undefined {
    if (config.executionEnv !== 'production' || config.storageBackend !== 'postgres') {
        return undefined;
    }

    const inlineCertificate = String(config.postgresDatabaseCaCert || '').trim();
    const certificatePath = String(config.postgresDatabaseCaCertPath || '').trim();

    if (!inlineCertificate && !certificatePath) {
        throw new Error('DOORDASH_PRODUCTION_DATABASE_CA_CERT or DOORDASH_PRODUCTION_DATABASE_CA_CERT_PATH is required for production Postgres TLS.');
    }

    if (inlineCertificate) {
        return {
            ca: validateCertificatePem(inlineCertificate, 'DOORDASH_PRODUCTION_DATABASE_CA_CERT'),
            rejectUnauthorized: true,
        };
    }

    try {
        return {
            ca: validateCertificatePem(readFile(certificatePath), 'DOORDASH_PRODUCTION_DATABASE_CA_CERT_PATH'),
            rejectUnauthorized: true,
        };
    } catch (error) {
        if (error instanceof Error && error.message.includes('BEGIN CERTIFICATE')) {
            throw error;
        }
        throw new Error('DOORDASH_PRODUCTION_DATABASE_CA_CERT_PATH could not be read.');
    }
}

export function buildPostgresPoolConfig(
    databaseUrl: string,
    options: {
        ssl?: PoolConfig['ssl'];
        poolConfig?: Partial<PoolConfig>;
    } = {},
): PoolConfig {
    return {
        max: 6,
        allowExitOnIdle: true,
        application_name: 'doordash-weekly-production',
        ...options.poolConfig,
        connectionString: options.ssl ? buildExplicitSslConnectionString(databaseUrl) : databaseUrl,
        ssl: options.ssl,
    };
}
