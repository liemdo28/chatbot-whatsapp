import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from './logs';

const DB_PATH = process.env.LOCAL_DB_PATH || './data/qb-ops-agent.sqlite';

let db: sqlite3.Database | null = null;
let initialized = false;

function getDbPath(): string {
  return path.isAbsolute(DB_PATH) ? DB_PATH : path.join(process.cwd(), DB_PATH);
}

export function getDb(): sqlite3.Database {
  if (db) return db;
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new sqlite3.Database(dbPath);
  initSchema();
  logger.info('Local SQLite database initialized', { path: dbPath });
  return db;
}

function run(sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID ?? 0, changes: this.changes ?? 0 });
    });
  });
}

function get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

function exec(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    getDb().exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function initSchema(): void {
  if (initialized) return;
  initialized = true;
  void exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS machines (
      machine_id TEXT PRIMARY KEY,
      hostname TEXT NOT NULL,
      windows_username TEXT,
      os_version TEXT,
      ip_address TEXT,
      agent_version TEXT NOT NULL,
      quickbooks_version TEXT,
      registered_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      status TEXT DEFAULT 'online'
    );

    CREATE TABLE IF NOT EXISTS company_files (
      company_file_id TEXT PRIMARY KEY,
      company_name TEXT,
      company_file_path TEXT NOT NULL,
      last_opened_at TEXT,
      last_checked_at TEXT,
      status TEXT DEFAULT 'unknown',
      assigned_store TEXT,
      assigned_department TEXT,
      notes TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_name TEXT NOT NULL,
      company_file_id TEXT,
      machine_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      summary TEXT,
      actions_json TEXT
    );

    CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id TEXT NOT NULL,
      workflow TEXT,
      action_name TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbound_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 5,
      created_at TEXT NOT NULL,
      last_attempt_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `).catch((error) => {
    logger.error('Failed to initialize SQLite schema', { error: error instanceof Error ? error.message : String(error) });
  });
}

export interface MachineRecord {
  machine_id: string;
  hostname: string;
  windows_username: string | null;
  os_version: string | null;
  ip_address: string | null;
  agent_version: string;
  quickbooks_version: string | null;
  registered_at: string;
  last_seen_at: string;
  status: string;
}

export function upsertMachine(m: MachineRecord): void {
  void run(
    `INSERT INTO machines (machine_id, hostname, windows_username, os_version, ip_address, agent_version, quickbooks_version, registered_at, last_seen_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(machine_id) DO UPDATE SET
       hostname = excluded.hostname,
       windows_username = excluded.windows_username,
       os_version = excluded.os_version,
       ip_address = excluded.ip_address,
       quickbooks_version = excluded.quickbooks_version,
       last_seen_at = excluded.last_seen_at,
       status = excluded.status`,
    [m.machine_id, m.hostname, m.windows_username, m.os_version, m.ip_address, m.agent_version, m.quickbooks_version, m.registered_at, m.last_seen_at, m.status]
  ).catch((error) => logger.error('Failed to upsert machine', { error: error instanceof Error ? error.message : String(error) }));
}

export function getMachine(machineId: string): MachineRecord | undefined {
  logger.warn('getMachine is async-backed and returns cached/undefined in Phase 1 implementation', { machineId });
  return undefined;
}

export interface CompanyFileRecord {
  company_file_id: string;
  company_name: string | null;
  company_file_path: string;
  last_opened_at: string | null;
  last_checked_at: string | null;
  status: string;
  assigned_store: string | null;
  assigned_department: string | null;
  notes: string | null;
  machine_id: string;
  created_at: string;
  updated_at: string;
}

export function upsertCompanyFile(f: CompanyFileRecord): void {
  void run(
    `INSERT INTO company_files (company_file_id, company_name, company_file_path, last_opened_at, last_checked_at, status, assigned_store, assigned_department, notes, machine_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_file_id) DO UPDATE SET
       company_name = excluded.company_name,
       company_file_path = excluded.company_file_path,
       last_opened_at = excluded.last_opened_at,
       last_checked_at = excluded.last_checked_at,
       status = excluded.status,
       assigned_store = excluded.assigned_store,
       assigned_department = excluded.assigned_department,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
    [f.company_file_id, f.company_name, f.company_file_path, f.last_opened_at, f.last_checked_at, f.status, f.assigned_store, f.assigned_department, f.notes, f.machine_id, f.created_at, f.updated_at]
  ).catch((error) => logger.error('Failed to upsert company file', { error: error instanceof Error ? error.message : String(error) }));
}

export function getCompanyFiles(_machineId?: string): CompanyFileRecord[] {
  logger.warn('getCompanyFiles is async-backed and returns empty list in Phase 1 compatibility implementation');
  return [];
}

export interface WorkflowRunRecord {
  workflow_name: string;
  company_file_id: string | null;
  machine_id: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  summary?: string | null;
  actions_json?: string | null;
}

export function insertWorkflowRun(r: WorkflowRunRecord): number {
  void run(
    `INSERT INTO workflow_runs (workflow_name, company_file_id, machine_id, status, started_at, completed_at, summary, actions_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.workflow_name, r.company_file_id, r.machine_id, r.status, r.started_at, r.completed_at ?? null, r.summary ?? null, r.actions_json ?? null]
  ).catch((error) => logger.error('Failed to insert workflow run', { error: error instanceof Error ? error.message : String(error) }));
  return 0;
}

export function completeWorkflowRun(id: number, status: string, summary: string, actionsJson: string): void {
  void run(
    'UPDATE workflow_runs SET completed_at = ?, status = ?, summary = ?, actions_json = ? WHERE id = ?',
    [new Date().toISOString(), status, summary, actionsJson, id]
  ).catch((error) => logger.error('Failed to complete workflow run', { error: error instanceof Error ? error.message : String(error) }));
}

export interface ActionLogRecord {
  machine_id: string;
  workflow: string | null;
  action_name: string;
  status: string;
  message: string | null;
  created_at: string;
}

export function logAction(a: ActionLogRecord): void {
  void run(
    'INSERT INTO action_logs (machine_id, workflow, action_name, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [a.machine_id, a.workflow, a.action_name, a.status, a.message, a.created_at]
  ).catch((error) => logger.error('Failed to log action', { error: error instanceof Error ? error.message : String(error) }));
}

export interface QueueItem {
  id: number;
  payload: string;
  endpoint: string;
  attempts: number;
  max_attempts: number;
  created_at: string;
  last_attempt_at: string | null;
  error: string | null;
}

export function enqueueOutbound(payload: object, endpoint: string): number {
  void run(
    'INSERT INTO outbound_queue (payload, endpoint, attempts, created_at) VALUES (?, ?, 0, ?)',
    [JSON.stringify(payload), endpoint, new Date().toISOString()]
  ).catch((error) => logger.error('Failed to enqueue outbound payload', { error: error instanceof Error ? error.message : String(error) }));
  return 0;
}

export function getQueuedItems(_limit = 20): QueueItem[] {
  logger.warn('getQueuedItems is async-backed and returns empty list in Phase 1 compatibility implementation');
  return [];
}

export function markQueueItemAttempted(id: number, error: string | null): void {
  void run(
    'UPDATE outbound_queue SET attempts = attempts + 1, last_attempt_at = ?, error = ? WHERE id = ?',
    [new Date().toISOString(), error, id]
  ).catch((err) => logger.error('Failed to update queue attempt', { error: err instanceof Error ? err.message : String(err) }));
}

export function removeFromQueue(id: number): void {
  void run('DELETE FROM outbound_queue WHERE id = ?', [id])
    .catch((error) => logger.error('Failed to remove queue item', { error: error instanceof Error ? error.message : String(error) }));
}

export function getQueueDepth(): number {
  return 0;
}

export function getSetting(key: string): string | null {
  const settingsPath = path.join(path.dirname(getDbPath()), 'settings-cache.json');
  if (!fs.existsSync(settingsPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, string>;
    return data[key] ?? null;
  } catch {
    return null;
  }
}

export function setSetting(key: string, value: string): void {
  const settingsPath = path.join(path.dirname(getDbPath()), 'settings-cache.json');
  let data: Record<string, string> = {};
  if (fs.existsSync(settingsPath)) {
    try { data = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, string>; } catch {}
  }
  data[key] = value;
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
  void run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  ).catch((error) => logger.error('Failed to persist setting', { error: error instanceof Error ? error.message : String(error) }));
}

export function closeDb(): void {
  if (db) {
    db.close((err) => {
      if (err) logger.error('Error closing database', { error: err.message });
      else logger.info('Database connection closed');
    });
    db = null;
    initialized = false;
  }
}
