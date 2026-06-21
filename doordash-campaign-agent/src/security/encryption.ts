/**
 * Encryption utility for credential storage.
 * Uses AES-256-GCM via Node.js crypto.
 * Never stores raw passwords.
 */
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const ITERATIONS = 100000;
const DIGEST = 'sha512';

export interface EncryptedPayload {
    encrypted: string;
    iv: string;
    tag: string;
    salt: string;
    version: number;
}

/**
 * Derive encryption key from master password using PBKDF2.
 * The master key is stored in environment or generated per machine.
 */
function getMasterKey(): Buffer {
    const masterKey = process.env['DD_ENCRYPTION_KEY'];
    if (masterKey) {
        return Buffer.from(masterKey, 'hex');
    }
    // Fallback: machine-specific key (not for production)
    const machineKey = crypto.createHash('sha256')
        .update(`dd-campaign-agent-${process.env['COMPUTERNAME'] || 'unknown'}`)
        .digest();
    return machineKey;
}

/**
 * Encrypt a plaintext password.
 * Returns encrypted payload with all components needed for decryption.
 */
export function encryptPassword(plaintext: string): EncryptedPayload {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = crypto.pbkdf2Sync(getMasterKey(), salt, ITERATIONS, KEY_LENGTH, DIGEST);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    return {
        encrypted,
        iv: iv.toString('hex'),
        tag,
        salt: salt.toString('hex'),
        version: 1,
    };
}

/**
 * Decrypt a password that was encrypted with encryptPassword.
 */
export function decryptPassword(payload: EncryptedPayload): string {
    const salt = Buffer.from(payload.salt, 'hex');
    const key = crypto.pbkdf2Sync(getMasterKey(), salt, ITERATIONS, KEY_LENGTH, DIGEST);
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(payload.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Serialize encrypted payload to JSON string for storage.
 */
export function serializeEncrypted(payload: EncryptedPayload): string {
    return JSON.stringify(payload);
}

/**
 * Deserialize JSON string to encrypted payload.
 */
export function deserializeEncrypted(json: string): EncryptedPayload {
    const parsed = JSON.parse(json);
    if (!parsed.encrypted || !parsed.iv || !parsed.tag || !parsed.salt) {
        throw new Error('Invalid encrypted payload format');
    }
    return parsed as EncryptedPayload;
}

/**
 * Quick check if a stored credential is encrypted (non-empty, valid format).
 */
export function isCredentialSet(encryptedJson: string): boolean {
    if (!encryptedJson || encryptedJson === '""' || encryptedJson === '') return false;
    try {
        const parsed = JSON.parse(encryptedJson);
        return !!(parsed.encrypted && parsed.encrypted.length > 0);
    } catch {
        return false;
    }
}