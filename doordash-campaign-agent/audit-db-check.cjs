const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'data', 'doordash-campaigns.db'));

console.log('=== STORES ===');
const stores = db.prepare('SELECT * FROM stores').all();
console.log(JSON.stringify(stores, null, 2));

console.log('\n=== SESSIONS ===');
const sessions = db.prepare('SELECT * FROM sessions').all();
console.log(JSON.stringify(sessions, null, 2));

console.log('\n=== CREDENTIALS STATUS ===');
const creds = db.prepare('SELECT id, store_id, credential_status, last_verified_at FROM credentials').all();
console.log(JSON.stringify(creds, null, 2));

console.log('\n=== CAMPAIGN SNAPSHOTS (count by store) ===');
const snapCounts = db.prepare('SELECT store_id, COUNT(*) as count FROM campaign_snapshots GROUP BY store_id').all();
console.log(JSON.stringify(snapCounts, null, 2));

console.log('\n=== LATEST SNAPSHOTS ===');
const latestSnaps = db.prepare('SELECT id, store_id, campaign_name, status, budget, spend, sales, roas, created_at FROM campaign_snapshots ORDER BY created_at DESC LIMIT 10').all();
console.log(JSON.stringify(latestSnaps, null, 2));

console.log('\n=== RECOMMENDATIONS ===');
const recs = db.prepare('SELECT id, store_id, recommendation_type, proposed_setting, status, confidence FROM recommendations ORDER BY created_at DESC LIMIT 20').all();
console.log(JSON.stringify(recs, null, 2));

console.log('\n=== APPROVALS ===');
const approvals = db.prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT 10').all();
console.log(JSON.stringify(approvals, null, 2));

console.log('\n=== SETTINGS ===');
const settings = db.prepare('SELECT * FROM settings').all();
console.log(JSON.stringify(settings, null, 2));

db.close();
console.log('\n[DONE]');
