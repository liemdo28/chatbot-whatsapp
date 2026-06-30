#!/usr/bin/env node
/**
 * Revenue Upload - run this on laptop1 to send Toast/DoorDash CSV to Mi-Core.
 *
 * Usage:
 *   node upload-revenue.mjs toast ./toast-export.csv
 *   node upload-revenue.mjs doordash ./doordash-export.csv
 *
 * Set MI_CORE_URL if Mi-Core is on a different machine (it is):
 *   MI_CORE_URL=http://192.168.x.x:4001 node upload-revenue.mjs toast toast.csv
 *
 * Find Mi-Core IP: on Mi-Core PC, run: ipconfig | findstr IPv4
 */

import fs from 'fs';
import path from 'path';

const [, , source, csvPath] = process.argv;

if (!source || !csvPath) {
  console.error('Usage: node upload-revenue.mjs <toast|doordash> <path-to-csv>');
  console.error('');
  console.error('Export steps:');
  console.error('  Toast:    https://pos.toasttab.com -> Reports -> Sales Summary -> Export CSV');
  console.error('  DoorDash: Merchant Portal -> Financials -> Payouts -> Export');
  process.exit(1);
}

if (!['toast', 'doordash'].includes(source)) {
  console.error(`Unknown source "${source}" - must be "toast" or "doordash"`);
  process.exit(1);
}

const MI_CORE_URL = process.env.MI_CORE_URL || 'http://localhost:4001';
const absPath = path.resolve(csvPath);

if (!fs.existsSync(absPath)) {
  console.error(`File not found: ${absPath}`);
  process.exit(1);
}

const csv = fs.readFileSync(absPath, 'utf-8');
const lines = csv.split('\n').filter(l => l.trim()).length;
console.log(`Uploading ${source} CSV (${lines} rows) -> ${MI_CORE_URL}/api/revenue/intake ...`);

try {
  const res = await fetch(`${MI_CORE_URL}/api/revenue/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, csv }),
  });

  const data = await res.json();

  if (data.ok) {
    console.log('\n SUCCESS');
    console.log(`   Source  : ${data.source}`);
    console.log(`   Imported: ${data.rows_imported} rows`);
    console.log(`   Period  : ${data.period}`);
    if (data.total_estimate) console.log(`   Total $ : $${data.total_estimate.toLocaleString()}`);
    console.log('\n' + data.summary);
  } else {
    console.error('\n FAILED:', data.error);
    if (data.hint) console.error('Hint:', data.hint);
    process.exit(1);
  }
} catch (e) {
  console.error('\n ERROR connecting to Mi-Core:', e.message);
  console.error(`Make sure Mi-Core is running at ${MI_CORE_URL}`);
  console.error('Set MI_CORE_URL=http://<mi-core-ip>:4001 and retry');
  process.exit(1);
}
