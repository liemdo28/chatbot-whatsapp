import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CompanyFileRecord, getCompanyFiles, upsertCompanyFile } from '../storage/local-db';
import { logger } from '../storage/logs';

const SETTINGS_FILE = path.join(process.cwd(), 'data', 'company-files.json');

export interface ConfiguredCompanyFile {
  company_file_id: string;
  company_name: string | null;
  company_file_path: string;
  assigned_store: string | null;
  assigned_department: string | null;
  notes: string | null;
}

function ensureSettingsFile(): void {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, '[]', 'utf8');
}

function hashPath(filePath: string): string {
  return crypto.createHash('sha256').update(filePath.toLowerCase()).digest('hex').slice(0, 32);
}

export function loadConfiguredCompanyFiles(): ConfiguredCompanyFile[] {
  ensureSettingsFile();
  const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
  const parsed = JSON.parse(raw) as Array<Partial<ConfiguredCompanyFile>>;
  return parsed.map((file) => ({
    company_file_id: file.company_file_id || hashPath(file.company_file_path || ''),
    company_name: file.company_name || null,
    company_file_path: file.company_file_path || '',
    assigned_store: file.assigned_store || null,
    assigned_department: file.assigned_department || null,
    notes: file.notes || null,
  })).filter(f => !!f.company_file_path);
}

export function syncConfiguredCompanyFiles(machineId: string): CompanyFileRecord[] {
  const configured = loadConfiguredCompanyFiles();
  const now = new Date().toISOString();

  for (const file of configured) {
    upsertCompanyFile({
      company_file_id: file.company_file_id,
      company_name: file.company_name,
      company_file_path: file.company_file_path,
      last_opened_at: null,
      last_checked_at: now,
      status: fs.existsSync(file.company_file_path) ? 'configured' : 'missing',
      assigned_store: file.assigned_store,
      assigned_department: file.assigned_department,
      notes: file.notes,
      machine_id: machineId,
      created_at: now,
      updated_at: now,
    });
  }

  const result = getCompanyFiles(machineId);
  logger.info('Configured company files synchronized', { machineId, count: result.length });
  return result;
}

export function addConfiguredCompanyFile(machineId: string, filePath: string, companyName?: string): ConfiguredCompanyFile {
  const existing = loadConfiguredCompanyFiles();
  const normalizedPath = path.normalize(filePath);
  const item: ConfiguredCompanyFile = {
    company_file_id: hashPath(normalizedPath),
    company_name: companyName || path.basename(normalizedPath, path.extname(normalizedPath)),
    company_file_path: normalizedPath,
    assigned_store: null,
    assigned_department: null,
    notes: null,
  };

  const deduped = existing.filter(f => f.company_file_path.toLowerCase() !== normalizedPath.toLowerCase());
  deduped.push(item);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(deduped, null, 2), 'utf8');
  syncConfiguredCompanyFiles(machineId);
  return item;
}

export function getTrackedCompanyFiles(machineId: string): CompanyFileRecord[] {
  return getCompanyFiles(machineId);
}
