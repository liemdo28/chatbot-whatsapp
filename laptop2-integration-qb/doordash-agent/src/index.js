/**
 * DoorDash Agent — HTTP server + scheduled scraper
 * Port: 3460
 * Runs on: laptop1 (100.111.97.25) or mi-core-primary
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const express = require('express');
const fs = require('fs');
const path = require('path');
const { runScrape } = require('./scraper');
const ACCOUNTS = require('./accounts');

const PORT = process.env.DD_AGENT_PORT || 3460;
const DATA_DIR = path.join(__dirname, '../data');
const CACHE_FILE = path.join(DATA_DIR, 'latest-metrics.json');
const LOG_FILE = path.join(__dirname, '../logs/agent.log');

const app = express();
app.use(express.json());

// In-memory state
let scrapeCache = null;
let scrapeStatus = { running: false, last_run: null, last_error: null };

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      scrapeCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch { scrapeCache = null; }
}

function saveCache(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  scrapeCache = data;
}

async function runAllAccounts() {
  if (scrapeStatus.running) {
    log('Scrape already running, skipping');
    return;
  }
  scrapeStatus.running = true;
  scrapeStatus.last_run = new Date().toISOString();
  log(`Starting scrape for ${ACCOUNTS.length} accounts`);

  const results = [];
  for (const account of ACCOUNTS) {
    log(`Scraping ${account.id} (${account.email})`);
    try {
      const result = await runScrape(account, true);
      results.push({ ...result, brand: account.brand, label: account.label });
      log(`${account.id}: ${result.stores?.length || 0} stores, error=${result.error || 'none'}`);
    } catch (err) {
      log(`${account.id}: FATAL ${err.message}`);
      results.push({ account_id: account.id, brand: account.brand, label: account.label, error: err.message, stores: [] });
    }
  }

  const payload = { scraped_at: new Date().toISOString(), accounts: results };
  saveCache(payload);
  scrapeStatus.running = false;
  scrapeStatus.last_error = results.some(r => r.error) ? 'some accounts failed' : null;
  log('Scrape complete');
  return payload;
}

// ── Routes ─────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    running: scrapeStatus.running,
    last_run: scrapeStatus.last_run,
    last_error: scrapeStatus.last_error,
    accounts: ACCOUNTS.length,
    has_cache: !!scrapeCache,
  });
});

// Latest cached data
app.get('/metrics', (req, res) => {
  if (!scrapeCache) {
    return res.status(404).json({ error: 'No data yet. POST /scrape to trigger.' });
  }
  res.json(scrapeCache);
});

// Trigger scrape (non-blocking)
app.post('/scrape', (req, res) => {
  if (scrapeStatus.running) {
    return res.json({ status: 'already_running', started_at: scrapeStatus.last_run });
  }
  res.json({ status: 'started', message: 'Scrape triggered. GET /metrics in ~60s.' });
  runAllAccounts().catch(err => log(`runAllAccounts error: ${err.message}`));
});

// Scrape single account
app.post('/scrape/:accountId', async (req, res) => {
  const account = ACCOUNTS.find(a => a.id === req.params.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  try {
    const result = await runScrape(account, true);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List accounts
app.get('/accounts', (req, res) => {
  res.json(ACCOUNTS.map(a => ({ id: a.id, brand: a.brand, label: a.label, email: a.email })));
});

// ── Start ───────────────────────────────────────────────────────────────────

loadCache();

app.listen(PORT, '0.0.0.0', () => {
  log(`DoorDash Agent listening on port ${PORT}`);
  log(`Accounts: ${ACCOUNTS.map(a => a.id).join(', ')}`);

  // Auto-scrape on startup after 10s delay
  setTimeout(() => {
    log('Auto-scrape on startup...');
    runAllAccounts().catch(err => log(`Startup scrape error: ${err.message}`));
  }, 10000);
});

// Schedule: every 6 hours
setInterval(() => {
  log('Scheduled scrape (6h interval)');
  runAllAccounts().catch(err => log(`Scheduled scrape error: ${err.message}`));
}, 6 * 60 * 60 * 1000);
