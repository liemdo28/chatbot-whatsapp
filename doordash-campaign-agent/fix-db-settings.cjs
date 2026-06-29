const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'data', 'doordash-campaigns.db'));

console.log('[FIX] Updating MI_CORE_URL to match .env...');
db.prepare("UPDATE settings SET value = 'http://100.118.102.113:4001', updated_at = datetime('now') WHERE key = 'mi_core_url'").run();

console.log('[FIX] Updating store emails to real DoorDash account emails...');
const storeUpdates = [
    { id: 'bakudan-the-rim', email: 'bakudanramen210@gmail.com' },
    { id: 'bakudan-stone-oak', email: 'gm@bakudanramen.com' },
    { id: 'bakudan-bandera', email: 'info@bakudanramen.com' },
    { id: 'raw-sushi-bar', email: 'infoheoholding@gmail.com' },
];
const updateStore = db.prepare('UPDATE stores SET email = ?, updated_at = datetime(\'now\') WHERE id = ?');
for (const s of storeUpdates) {
    updateStore.run(s.email, s.id);
    console.log(`  Updated ${s.id} -> ${s.email}`);
}

console.log('[FIX] Resetting session statuses to reflect no real login has succeeded...');
const resetSessions = [
    { id: 'session-bakudan-the-rim', store_id: 'bakudan-the-rim' },
    { id: 'session-bakudan-stone-oak', store_id: 'bakudan-stone-oak' },
    { id: 'session-bakudan-bandera', store_id: 'bakudan-bandera' },
    { id: 'session-raw-sushi-bar', store_id: 'raw-sushi-bar' },
];
const resetSession = db.prepare("UPDATE sessions SET session_status = 'none', two_fa_status = 'none', last_login_at = NULL, updated_at = datetime('now') WHERE store_id = ?");
for (const s of resetSessions) {
    resetSession.run(s.store_id);
    console.log(`  Reset session for ${s.store_id}`);
}

console.log('[FIX] Marking credentials as unset (no real credentials stored)...');
const resetCreds = db.prepare("UPDATE credentials SET credential_status = 'unset', last_verified_at = NULL, updated_at = datetime('now') WHERE 1=1");
resetCreds.run();

console.log('[VERIFY] Settings after fix:');
const settings = db.prepare('SELECT * FROM settings').all();
console.log(JSON.stringify(settings, null, 2));

console.log('[VERIFY] Stores after fix:');
const stores = db.prepare('SELECT id, name, email, active FROM stores').all();
console.log(JSON.stringify(stores, null, 2));

console.log('[VERIFY] Sessions after fix:');
const sessions = db.prepare('SELECT store_id, session_status, last_login_at, two_fa_status FROM sessions').all();
console.log(JSON.stringify(sessions, null, 2));

console.log('[VERIFY] Credentials after fix:');
const creds = db.prepare('SELECT store_id, credential_status, last_verified_at FROM credentials').all();
console.log(JSON.stringify(creds, null, 2));

db.close();
console.log('\n[DONE] All DB settings fixed.');
