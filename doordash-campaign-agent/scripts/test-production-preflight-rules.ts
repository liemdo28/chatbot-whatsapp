import assert from 'node:assert/strict';
import path from 'path';
import { spawnSync } from 'node:child_process';

const cliPath = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
const databaseUrl = new URL('postgres://127.0.0.1:1/doordash_validation');
databaseUrl.username = 'validator';
databaseUrl.password = 'validator_password';
const result = spawnSync(process.execPath, [
    cliPath,
    'scripts/run-production-preflight.ts',
    '--trigger',
    'rules-test',
    '--stores',
    'raw-sushi-bar',
], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
        ...process.env,
        DD_EXECUTION_ENV: 'production',
        ANALYSIS_PROVIDER: 'rules',
        DD_REPORT_SOURCE: 'imap',
        DD_STORAGE_BACKEND: 'postgres',
        DATABASE_URL: databaseUrl.toString(),
        IMAP_USER: 'rules@example.com',
        IMAP_PASS: 'not-a-real-password',
        DD_REPORT_ALLOWED_SENDERS: 'reports@doordash.com',
        IMAP_HOST: 'imap.example.com',
        IMAP_PORT: '993',
        IMAP_SECURE: 'true',
        DD_STORE_TIMEZONE: 'America/Los_Angeles',
        DD_STORE_CURRENCY: 'USD',
        DD_REPORT_INBOX_LABEL: 'INBOX',
    },
});

assert.notEqual(result.status, 0);
const stdout = result.stdout || '';
assert.equal(stdout.includes('OPENAI_API_KEY'), false);
assert.equal(stdout.includes('"step": "config"'), true);
assert.equal(stdout.includes('"status": "success"'), true);
assert.equal(stdout.includes('"step": "postgres"') || stdout.includes('"step": "imap_auth"'), true);

console.log('production-preflight-rules tests passed');
