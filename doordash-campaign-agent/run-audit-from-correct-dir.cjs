/**
 * Launcher script for running campaign audit from the correct directory.
 * Changes working directory to the project root before running.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Change to the project directory
const projectDir = path.join(__dirname);
process.chdir(projectDir);

console.log('[LAUNCHER] Working directory:', process.cwd());
console.log('[LAUNCHER] Loading .env...');

// Load dotenv manually
const envPath = path.join(projectDir, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (key && !process.env[key]) {
            process.env[key] = value;
        }
    }
    console.log('[LAUNCHER] .env loaded. DB_PATH:', process.env.DB_PATH);
} else {
    console.error('[LAUNCHER] .env not found at', envPath);
}

const distAuditPath = path.join(projectDir, 'dist', 'audit', 'run-campaign-audit.js');

if (!fs.existsSync(distAuditPath)) {
    console.error('[LAUNCHER] Compiled audit not found at:', distAuditPath);
    console.error('[LAUNCHER] Run "npx tsc" first to compile TypeScript.');
    process.exit(1);
}

console.log('[LAUNCHER] Starting campaign audit...');
console.log('[LAUNCHER] Executing:', `node "${distAuditPath}"`);

const child = spawn('node', [distAuditPath], {
    cwd: projectDir,
    env: process.env,
    stdio: 'inherit',
    shell: true,
});

child.on('exit', (code) => {
    console.log('[LAUNCHER] Audit process exited with code:', code);
    process.exit(code || 0);
});

child.on('error', (err) => {
    console.error('[LAUNCHER] Failed to start audit:', err);
    process.exit(1);
});
