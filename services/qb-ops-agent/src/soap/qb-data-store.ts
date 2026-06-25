/**
 * Stores raw QBXML responses from QBWC into SQLite for the workflow engine.
 * Also parses incoming data on the fly and exposes structured financial data.
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../storage/logs';
import { parseAllFinancialData, ParsedFinancialData } from './qbxml-parser';

const DATA_DIR = process.env.LOCAL_DB_PATH
  ? path.dirname(process.env.LOCAL_DB_PATH)
  : path.join(process.cwd(), 'data');

const QB_DATA_FILE = path.join(DATA_DIR, 'qb-raw-data.json');
const SYNC_STATUS_FILE = path.join(DATA_DIR, 'qb-sync-status.json');
const PARSED_DATA_FILE = path.join(DATA_DIR, 'qb-parsed-financial.json');

interface SyncStatus {
  last_sync: string | null;
  last_company_file: string | null;
  requests_received: number;
  total_bytes: number;
  error: string | null;
}

interface RawDataEntry {
  request_index: number;
  company_file: string;
  received_at: string;
  xml: string;
}

let syncStatus: SyncStatus = {
  last_sync: null,
  last_company_file: null,
  requests_received: 0,
  total_bytes: 0,
  error: null,
};

// In-memory cache for the latest parsed data — populated whenever storeQbData
// runs parseAllFinancialData. Read by the financial API endpoint.
let parsedCache: ParsedFinancialData | null = null;

// Load existing status on startup
try {
  if (fs.existsSync(SYNC_STATUS_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(SYNC_STATUS_FILE, 'utf-8'));
    syncStatus = {
      last_sync: loaded.last_sync ?? null,
      last_company_file: loaded.last_company_file ?? null,
      requests_received: loaded.requests_received ?? 0,
      total_bytes: loaded.total_bytes ?? 0,
      error: loaded.error ?? null,
    };
  }
} catch { /* ignore */ }

// Load existing parsed data on startup
try {
  if (fs.existsSync(PARSED_DATA_FILE)) {
    parsedCache = JSON.parse(fs.readFileSync(PARSED_DATA_FILE, 'utf-8'));
  }
} catch { /* ignore */ }

/**
 * Read all stored raw entries, deduped by request_index.
 * Keeps the latest entry per request_index (so re-syncs overwrite).
 */
function loadRawEntries(): RawDataEntry[] {
  if (!fs.existsSync(QB_DATA_FILE)) return [];
  try {
    const all: Record<string, RawDataEntry> = JSON.parse(fs.readFileSync(QB_DATA_FILE, 'utf-8'));
    // Get latest per request_index
    const latestPerIndex = new Map<number, RawDataEntry>();
    for (const entry of Object.values(all)) {
      const existing = latestPerIndex.get(entry.request_index);
      if (!existing || new Date(entry.received_at) > new Date(existing.received_at)) {
        latestPerIndex.set(entry.request_index, entry);
      }
    }
    return Array.from(latestPerIndex.values()).sort((a, b) => a.request_index - b.request_index);
  } catch {
    return [];
  }
}

/**
 * Re-parse all stored raw data and persist the parsed result.
 */
function rebuildParsedCache(): void {
  try {
    const entries = loadRawEntries();
    if (!entries.length) {
      parsedCache = null;
      return;
    }
    const parsed = parseAllFinancialData(
      entries.map(e => ({ request_index: e.request_index, xml: e.xml }))
    );
    parsedCache = parsed;
    if (parsed) {
      fs.writeFileSync(PARSED_DATA_FILE, JSON.stringify(parsed, null, 2));
      logger.info('Parsed financial data cached', {
        accounts: parsed.accounts.length,
        sales: parsed.sales_receipts.length,
        invoices: parsed.invoices.length,
      });
    }
  } catch (err) {
    logger.error('Failed to rebuild parsed cache', {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export function storeQbData(requestIndex: number, companyFile: string, xmlResponse: string): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    // Append to raw data file (keyed by request index + timestamp)
    let existing: Record<string, RawDataEntry> = {};
    if (fs.existsSync(QB_DATA_FILE)) {
      try {
        existing = JSON.parse(fs.readFileSync(QB_DATA_FILE, 'utf-8'));
      } catch {
        existing = {};
      }
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

    // After every new response, re-parse so the financial endpoint stays fresh
    rebuildParsedCache();
  } catch (err) {
    logger.error(`Failed to store QB data: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function getLastSyncStatus(): SyncStatus {
  return syncStatus;
}

export function getSyncStatus(): SyncStatus {
  return syncStatus;
}

export function loadLatestFinancialData(): ParsedFinancialData | null {
  // If cache is empty but raw data exists, try to rebuild (handles process restart edge case)
  if (!parsedCache) {
    rebuildParsedCache();
  }
  return parsedCache;
}

/**
 * Expose the latest raw QBXML response per request_index for debugging.
 * Returns the actual XML returned by QuickBooks Desktop so the parser can be
 * tuned to match the real tag structure.
 */
export function loadLatestRawEntries(): RawDataEntry[] {
  return loadRawEntries();
}
