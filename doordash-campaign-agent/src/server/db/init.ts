import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env['DB_PATH'] || './data/doordash-campaigns.db';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
    if (!_db) {
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        _db = new Database(DB_PATH);
        _db.pragma('journal_mode = WAL');
        _db.pragma('foreign_keys = ON');
        initSchema(_db);
    }
    return _db;
}

export function closeDb(): void {
    if (_db) {
        _db.close();
        _db = null;
    }
}

function initSchema(db: Database.Database): void {
    db.exec(`
        -- Store accounts configuration
        CREATE TABLE IF NOT EXISTS stores (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            doorDashAccountId TEXT,
            active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Encrypted credentials (never store raw passwords)
        CREATE TABLE IF NOT EXISTS credentials (
            id TEXT PRIMARY KEY,
            store_id TEXT NOT NULL REFERENCES stores(id),
            encrypted_password TEXT NOT NULL,
            encryption_version INTEGER DEFAULT 1,
            credential_status TEXT DEFAULT 'unset',
            last_verified_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Browser sessions
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            store_id TEXT NOT NULL REFERENCES stores(id),
            session_path TEXT NOT NULL,
            session_status TEXT DEFAULT 'none',
            last_login_at TEXT,
            last_logout_at TEXT,
            two_fa_status TEXT DEFAULT 'none',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Campaign snapshots
        CREATE TABLE IF NOT EXISTS campaign_snapshots (
            id TEXT PRIMARY KEY,
            store_id TEXT NOT NULL REFERENCES stores(id),
            campaign_name TEXT NOT NULL,
            campaign_type TEXT,
            status TEXT,
            budget REAL,
            spend REAL,
            sales REAL,
            orders INTEGER,
            roas REAL,
            start_date TEXT,
            end_date TEXT,
            currency TEXT DEFAULT 'USD',
            raw_data TEXT,
            screenshot_path TEXT,
            snapshot_date TEXT DEFAULT (datetime('now')),
            week_start TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Campaign recommendations
        CREATE TABLE IF NOT EXISTS recommendations (
            id TEXT PRIMARY KEY,
            store_id TEXT NOT NULL REFERENCES stores(id),
            campaign_snapshot_id TEXT REFERENCES campaign_snapshots(id),
            recommendation_type TEXT NOT NULL,
            current_setting TEXT,
            proposed_setting TEXT,
            expected_roi_impact REAL,
            expected_profit_impact REAL,
            confidence REAL,
            risk TEXT DEFAULT 'medium',
            reason TEXT,
            rollback_plan TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Approval queue
        CREATE TABLE IF NOT EXISTS approvals (
            id TEXT PRIMARY KEY,
            store_id TEXT NOT NULL REFERENCES stores(id),
            campaign_snapshot_id TEXT REFERENCES campaign_snapshots(id),
            recommendation_id TEXT REFERENCES recommendations(id),
            action_type TEXT NOT NULL,
            proposed_value TEXT,
            approved_value TEXT,
            status TEXT DEFAULT 'pending',
            approved_by TEXT,
            approved_at TEXT,
            rejected_reason TEXT,
            executed_at TEXT,
            execution_result TEXT,
            immutable_audit TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Execution logs
        CREATE TABLE IF NOT EXISTS execution_logs (
            id TEXT PRIMARY KEY,
            approval_id TEXT REFERENCES approvals(id),
            store_id TEXT NOT NULL REFERENCES stores(id),
            action TEXT NOT NULL,
            result TEXT,
            details TEXT,
            screenshot_before TEXT,
            screenshot_after TEXT,
            error_message TEXT,
            executed_at TEXT DEFAULT (datetime('now'))
        );

        -- MI-CORE sync state
        CREATE TABLE IF NOT EXISTS mi_core_sync (
            id TEXT PRIMARY KEY,
            sync_type TEXT NOT NULL,
            payload TEXT,
            mi_version TEXT,
            policy_version TEXT,
            playbook_version TEXT,
            sync_status TEXT DEFAULT 'pending',
            synced_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Settings
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Weekly loop runs
        CREATE TABLE IF NOT EXISTS loop_runs (
            id TEXT PRIMARY KEY,
            status TEXT DEFAULT 'idle',
            started_at TEXT,
            completed_at TEXT,
            summary TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Audit log (immutable)
        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            store_id TEXT,
            details TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);

    // Seed default stores if empty
    const count = db.prepare('SELECT COUNT(*) as cnt FROM stores').get() as { cnt: number };
    if (count.cnt === 0) {
        const insertStore = db.prepare('INSERT INTO stores (id, name, email) VALUES (?, ?, ?)');
        const insertCred = db.prepare('INSERT INTO credentials (id, store_id, encrypted_password, credential_status) VALUES (?, ?, ?, ?)');
        const insertSession = db.prepare('INSERT INTO sessions (id, store_id, session_path, session_status) VALUES (?, ?, ?, ?)');

        const stores = [
            { id: 'bakudan-the-rim', name: 'Bakudan The Rim', email: 'bakudan.rim@example.com' },
            { id: 'bakudan-stone-oak', name: 'Bakudan Stone Oak', email: 'bakudan.stoneoak@example.com' },
            { id: 'bakudan-bandera', name: 'Bakudan Bandera', email: 'bakudan.bandera@example.com' },
            { id: 'raw-sushi-bar', name: 'Raw Sushi Bar', email: 'raw.sushi@example.com' },
        ];

        const tx = db.transaction(() => {
            for (const s of stores) {
                insertStore.run(s.id, s.name, s.email);
                insertCred.run(`cred-${s.id}`, s.id, '', 'unset');
                insertSession.run(`session-${s.id}`, s.id, `./data/sessions/${s.id}`, 'none');
            }
        });
        tx();

        // Set default settings
        db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('machine_id', 'laptop-01');
        db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('mi_core_url', process.env['MI_CORE_URL'] || 'http://localhost:4001');
        db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('weekly_loop_enabled', 'true');
        db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('weekly_loop_day', '1'); // Monday
        db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('weekly_loop_hour', '8'); // 8 AM
        console.log('[DB] Seeded default stores.');
    }
}