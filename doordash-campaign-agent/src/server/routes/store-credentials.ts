/**
 * Store Credentials Routes
 * API endpoints for managing encrypted credential storage.
 * NEVER stores raw passwords. Uses AES-256-GCM encryption.
 */
import { Router } from 'express';
import { getDb } from '../db/init.js';
import { encryptPassword, serializeEncrypted, deserializeEncrypted, decryptPassword, isCredentialSet } from '../../security/encryption.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * GET /api/credentials — List all store credentials (encrypted password NOT exposed)
 */
router.get('/api/credentials', (_req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare(`
            SELECT c.id, c.store_id, c.credential_status, c.last_verified_at, c.encryption_version,
                   s.name as store_name, s.email
            FROM credentials c
            JOIN stores s ON c.store_id = s.id
            ORDER BY s.name
        `).all();
        res.json({ ok: true, credentials: rows });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/credentials/:storeId — Get credential info for a store
 */
router.get('/api/credentials/:storeId', (req, res) => {
    try {
        const db = getDb();
        const row = db.prepare(`
            SELECT c.id, c.store_id, c.credential_status, c.last_verified_at, c.encryption_version,
                   s.name as store_name, s.email
            FROM credentials c
            JOIN stores s ON c.store_id = s.id
            WHERE c.store_id = ?
        `).get(req.params.storeId);
        if (!row) return res.status(404).json({ ok: false, error: 'Credential not found' });
        res.json({ ok: true, credential: row });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/credentials/:storeId — Store encrypted password for a store
 * Body: { password: string }
 * Password is encrypted with AES-256-GCM and stored as encrypted JSON.
 */
router.post('/api/credentials/:storeId', (req, res) => {
    try {
        const { password } = req.body;
        if (!password || typeof password !== 'string') {
            return res.status(400).json({ ok: false, error: 'Password is required' });
        }

        // Encrypt the password
        const encrypted = encryptPassword(password);
        const encryptedJson = serializeEncrypted(encrypted);

        const db = getDb();
        const existing = db.prepare('SELECT id FROM credentials WHERE store_id = ?').get(req.params.storeId) as any;

        if (existing) {
            db.prepare('UPDATE credentials SET encrypted_password = ?, credential_status = ?, updated_at = datetime(\'now\') WHERE store_id = ?')
                .run(encryptedJson, 'stored', req.params.storeId);
        } else {
            db.prepare('INSERT INTO credentials (id, store_id, encrypted_password, credential_status) VALUES (?, ?, ?, ?)')
                .run(uuidv4(), req.params.storeId, encryptedJson, 'stored');
        }

        res.json({ ok: true, message: 'Password encrypted and stored securely.' });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * DELETE /api/credentials/:storeId — Remove stored credentials
 */
router.delete('/api/credentials/:storeId', (req, res) => {
    try {
        const db = getDb();
        db.prepare('UPDATE credentials SET encrypted_password = \'\', credential_status = \'unset\', updated_at = datetime(\'now\') WHERE store_id = ?')
            .run(req.params.storeId);
        res.json({ ok: true, message: 'Credentials cleared.' });
    } catch (error: any) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

export default router;