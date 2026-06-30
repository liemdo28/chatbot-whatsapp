/**
 * Stores raw QBXML responses from QBWC into SQLite for the workflow engine.
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../storage/logs';

const DATA_DIR = process.env.LOCAL_DB_PATH
  ? path.dirname(process.env.LOCAL_DB_PATH)
  : path.join(process.cwd(), 'data');

const QB_DATA_FILE = path.join(DATA_DIR, 'qb-raw-data.json');
const SYNC_STATUS_FILE = path.join(DATA_DIR, 'qb-sync-status.json');

interface SyncStatus {
  last_sync: string | null;
  last_company_file: string | null;
  requests_received: number;
  total_bytes: number;
  error: string | null;
}

let syncStatus: SyncStatus = {
  last_sync: null,
  last_company_file: null,
  requests_received: 0,
  total_bytes: 0,
  error: null,
};

// Load existing status on startup
try {
  if (fs.existsSync(SYNC_STATUS_FILE)) {
    syncStatus = JSON.parse(fs.readFileSync(SYNC_STATUS_FILE, 'utf-8'));
  }
} catch { /* ignore */ }

export function storeQbData(requestIndex: number, companyFile: string, xmlResponse: string): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    // Append to raw data file (keyed by request index + timestamp)
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(QB_DATA_FILE)) {
      try { existing = JSON.parse(fs.readFileSync(QB_DATA_FILE, 'utf-8')); } catch { existing = {}; }
    }

    const key = `req_${requestIndex}_${Date.now()}`;
    existing[key] = {
      request_index: requestIndex,
      company_file: companyFile,
      received_at: new Date().toISOString(),
      xml: xmlResponse,
    };

    fs.writeFileSync(QB_DATA_FILE, JSON.stringify(existing, null, 2));

    // Update sync status
    syncStatus.last_sync = new Date().toISOString();
    syncStatus.last_company_file = companyFile;
    syncStatus.requests_received++;
    syncStatus.total_bytes += xmlResponse.length;
    syncStatus.error = null;

    fs.writeFileSync(SYNC_STATUS_FILE, JSON.stringify(syncStatus, null, 2));

    logger.info(`QB data stored: request ${requestIndex}, ${xmlResponse.length} bytes, file: ${companyFile}`);
  } catch (err) {
    logger.error(`Failed to store QB data: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function getLastSyncStatus(): SyncStatus {
  return syncStatus;
}
