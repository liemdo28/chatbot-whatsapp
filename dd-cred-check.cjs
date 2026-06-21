const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'doordash-campaign-agent', 'data', 'doordash-campaigns.db');
const db = new Database(dbPath);

const creds = db.prepare('SELECT store_id, encrypted_password FROM credentials').all();
const sessions = db.prepare('SELECT store_id, session_status, last_login_at FROM sessions').all();

console.log('=== DOORDASH CREDENTIALS ===');
creds.forEach(c => {
    const hasPassword = !!(c.encrypted_password && c.encrypted_password.trim() !== '');
    console.log(c.store_id + ': has_password=' + hasPassword + ' | value_len=' + (c.encrypted_password ? c.encrypted_password.length : 0));
});

console.log('\n=== DOORDASH SESSIONS ===');
sessions.forEach(s => {
    console.log(s.store_id + ': status=' + s.session_status + ' | last_login=' + s.last_login_at);
});

db.close();
