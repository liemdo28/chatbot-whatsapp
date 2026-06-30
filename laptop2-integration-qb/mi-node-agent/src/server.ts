/**
 * Mi Node Agent — standalone Express server deployed to each laptop.
 * Auth: NODE_ID + NODE_SECRET header. Allowlisted commands/folders only.
 */

import 'dotenv/config';
import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const NODE_ID = process.env.NODE_ID || 'node-unknown';
const NODE_SECRET = process.env.NODE_SECRET || '';
const PORT = parseInt(process.env.NODE_AGENT_PORT || '4100');
const MI_CORE_URL = process.env.MI_CORE_URL || 'http://192.168.1.100:4001';

if (!NODE_SECRET) { console.error('NODE_SECRET required'); process.exit(1); }

// Allowlisted commands — exact strings or regex patterns
const COMMAND_ALLOWLIST: RegExp[] = [
  /^git status$/,
  /^git log --oneline -\d+$/,
  /^git pull$/,
  /^npm run build$/,
  /^npm run test$/,
  /^pm2 list$/,
  /^pm2 status$/,
  /^pm2 restart [a-zA-Z0-9_-]+$/,
  /^pm2 stop [a-zA-Z0-9_-]+$/,
  /^pm2 start [a-zA-Z0-9_-]+$/,
  /^node --version$/,
  /^docker ps$/,
  /^docker info$/,
];

// Allowlisted read-only folder roots
const FOLDER_ALLOWLIST = [
  process.env.PROJECT_DIR || 'C:/Projects',
  process.env.LOGS_DIR || 'C:/Logs',
];

function isCommandAllowed(cmd: string): boolean {
  return COMMAND_ALLOWLIST.some(re => re.test(cmd.trim()));
}

function isFolderAllowed(folderPath: string): boolean {
  const normalized = path.normalize(folderPath).toLowerCase();
  return FOLDER_ALLOWLIST.some(root => normalized.startsWith(path.normalize(root).toLowerCase()));
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret + 'mi-node-salt-2026').digest('hex');
}

const EXPECTED_HASH = hashSecret(NODE_SECRET);

function authenticate(req: express.Request, res: express.Response): boolean {
  const nodeId = req.headers['x-node-id'];
  const secretHash = req.headers['x-node-secret'];
  if (nodeId !== NODE_ID || secretHash !== EXPECTED_HASH) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return false;
  }
  return true;
}

const app = express();
app.use(express.json());

// Health
app.get('/health', (_req, res) => {
  res.json({ node_id: NODE_ID, status: 'online', timestamp: new Date().toISOString(), mi_core: MI_CORE_URL });
});

// Status — extended info
app.get('/status', (req, res) => {
  if (!authenticate(req, res)) return;
  res.json({
    node_id: NODE_ID,
    status: 'online',
    platform: process.platform,
    node_version: process.version,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Execute allowlisted command
app.post('/exec', async (req, res) => {
  if (!authenticate(req, res)) return;
  const { command, cwd } = req.body as { command: string; cwd?: string };
  if (!command) return res.status(400).json({ error: 'command required' });
  if (!isCommandAllowed(command)) return res.status(403).json({ error: 'COMMAND_NOT_ALLOWED', command });
  if (cwd && !isFolderAllowed(cwd)) return res.status(403).json({ error: 'FOLDER_NOT_ALLOWED', cwd });

  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 30_000, cwd: cwd || undefined });
    res.json({ success: true, stdout: stdout.slice(0, 10_000), stderr: stderr.slice(0, 1_000), command });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    res.status(500).json({ success: false, error, command });
  }
});

// Read file from allowlisted folder
app.get('/file', (req, res) => {
  if (!authenticate(req, res)) return;
  const filePath = String(req.query.path || '');
  if (!filePath || !isFolderAllowed(filePath)) return res.status(403).json({ error: 'FOLDER_NOT_ALLOWED' });
  if (!existsSync(filePath)) return res.status(404).json({ error: 'FILE_NOT_FOUND' });
  try {
    const content = readFileSync(filePath, 'utf8').slice(0, 100_000);
    res.json({ path: filePath, content, size: content.length });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Register self with Mi-Core on startup
async function registerWithMiCore() {
  try {
    await fetch(`${MI_CORE_URL}/api/nodes/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_id: NODE_ID,
        port: PORT,
        platform: process.platform,
        node_version: process.version,
      }),
      signal: AbortSignal.timeout(5000),
    });
    console.log(`[Node Agent] Registered with Mi-Core at ${MI_CORE_URL}`);
  } catch {
    console.warn('[Node Agent] Could not register with Mi-Core; continuing locally');
  }
}

app.listen(PORT, () => {
  console.log(`[Node Agent] ${NODE_ID} listening on port ${PORT}`);
  registerWithMiCore().catch(() => { /* ignore */ });
});
