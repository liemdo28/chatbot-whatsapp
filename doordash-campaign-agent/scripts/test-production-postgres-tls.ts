import assert from 'node:assert/strict';
import { sanitizeErrorMessage, sanitizeSecretString } from '../src/production/security/error-sanitizer.js';
import {
    buildExplicitSslConnectionString,
    buildPostgresPoolConfig,
    normalizeCertificatePem,
    resolveProductionPostgresTlsConfig,
} from '../src/production/storage/postgres-tls.js';

const multilinePem = [
    '-----BEGIN CERTIFICATE-----',
    'SYNTHETIC-ROOT-CA',
    '-----END CERTIFICATE-----',
].join('\n');
const escapedPem = '-----BEGIN CERTIFICATE-----\\nSYNTHETIC-ROOT-CA\\n-----END CERTIFICATE-----';

assert.equal(normalizeCertificatePem(multilinePem), `${multilinePem}\n`);
assert.equal(normalizeCertificatePem(escapedPem), `${multilinePem}\n`);

const inlineTls = resolveProductionPostgresTlsConfig({
    executionEnv: 'production',
    storageBackend: 'postgres',
    postgresDatabaseCaCert: escapedPem,
    postgresDatabaseCaCertPath: '',
});
assert.ok(inlineTls);
assert.equal(inlineTls.rejectUnauthorized, true);
assert.equal(inlineTls.ca, `${multilinePem}\n`);

const fileTls = resolveProductionPostgresTlsConfig({
    executionEnv: 'production',
    storageBackend: 'postgres',
    postgresDatabaseCaCert: '',
    postgresDatabaseCaCertPath: '/tmp/synthetic-supabase-ca.pem',
}, () => multilinePem);
assert.ok(fileTls);
assert.equal(fileTls.rejectUnauthorized, true);
assert.equal(fileTls.ca, `${multilinePem}\n`);

assert.throws(() => resolveProductionPostgresTlsConfig({
    executionEnv: 'production',
    storageBackend: 'postgres',
    postgresDatabaseCaCert: '',
    postgresDatabaseCaCertPath: '',
}), /DOORDASH_PRODUCTION_DATABASE_CA_CERT|DOORDASH_PRODUCTION_DATABASE_CA_CERT_PATH/);

assert.throws(() => resolveProductionPostgresTlsConfig({
    executionEnv: 'production',
    storageBackend: 'postgres',
    postgresDatabaseCaCert: 'totally-not-a-certificate',
    postgresDatabaseCaCertPath: '',
}), /BEGIN CERTIFICATE/);

assert.throws(() => resolveProductionPostgresTlsConfig({
    executionEnv: 'production',
    storageBackend: 'postgres',
    postgresDatabaseCaCert: '',
    postgresDatabaseCaCertPath: '/tmp/missing-ca.pem',
}, () => {
    throw new Error('ENOENT');
}), /could not be read/);

const localTls = resolveProductionPostgresTlsConfig({
    executionEnv: 'test',
    storageBackend: 'postgres',
    postgresDatabaseCaCert: '',
    postgresDatabaseCaCertPath: '',
});
assert.equal(localTls, undefined);

const remoteConnectionUrl = new URL('postgres://db.example.supabase.co:6543/postgres?sslmode=require&application_name=weekly-agent');
remoteConnectionUrl.username = 'validator';
remoteConnectionUrl.password = 'placeholder-password';

const poolConfig = buildPostgresPoolConfig(
    remoteConnectionUrl.toString(),
    { ssl: inlineTls },
);
assert.equal((poolConfig.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized, true);
assert.ok(String(poolConfig.connectionString).includes('db.example.supabase.co:6543'));
assert.ok(String(poolConfig.connectionString).includes('application_name=weekly-agent'));
assert.equal(String(poolConfig.connectionString).includes('sslmode='), false);

const localConnectionUrl = new URL('postgres://127.0.0.1:5432/doordash_validation');
localConnectionUrl.username = 'validator';
localConnectionUrl.password = 'placeholder-password';

const localPoolConfig = buildPostgresPoolConfig(localConnectionUrl.toString());
assert.equal(localPoolConfig.ssl, undefined);
assert.ok(String(localPoolConfig.connectionString).includes('127.0.0.1:5432/doordash_validation'));

const sanitizedError = sanitizeErrorMessage(new Error(`TLS failed ${multilinePem}`));
assert.equal(sanitizedError.includes('BEGIN CERTIFICATE'), false);
assert.equal(sanitizedError.includes('SYNTHETIC-ROOT-CA'), false);

const sanitizedSecret = sanitizeSecretString(`DOORDASH_PRODUCTION_DATABASE_CA_CERT=${escapedPem}`);
assert.equal(sanitizedSecret.includes('BEGIN CERTIFICATE'), false);
assert.equal(sanitizedSecret.includes('SYNTHETIC-ROOT-CA'), false);

const sanitizationUrl = new URL('postgres://db.example/postgres?sslmode=require&sslrootcert=ignored&connect_timeout=10');
sanitizationUrl.username = 'validator';
sanitizationUrl.password = 'placeholder-password';

const sanitizedConnectionString = buildExplicitSslConnectionString(sanitizationUrl.toString());
assert.equal(sanitizedConnectionString.includes('sslmode='), false);
assert.equal(sanitizedConnectionString.includes('sslrootcert='), false);
assert.ok(sanitizedConnectionString.includes('connect_timeout=10'));

console.log('production-postgres-tls tests passed');
