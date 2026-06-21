const Database = require('better-sqlite3');

const db = new Database('./doordash-campaign-agent/data/doordash-campaigns.db');

const stores = db.prepare('SELECT id, name, email FROM stores').all();
const creds = db.prepare('SELECT store_id, encrypted_password FROM credentials').all();
const sessions = db.prepare('SELECT store_id, session_status, last_login_at FROM sessions').all();

console.log('=== STORES ===');
console.log(JSON.stringify(stores, null, 2));

console.log('\n=== CREDENTIALS COUNT ===');
console.log('Total credentials:', creds.length);
creds.forEach(c => {
    console.log('  Store:', c.store_id, '| Has encrypted_password:', !!c.encrypted_password);
});

console.log('\n=== SESSIONS ===');
console.log(JSON.stringify(sessions, null, 2));

db.close();
