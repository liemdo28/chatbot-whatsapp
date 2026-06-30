import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

/**
 * Derives a 256-bit key from a passphrase using PBKDF2.
 * Salt should be stored alongside the encrypted data.
 */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, 100_000, KEY_LENGTH, 'sha256');
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Returns a Buffer: [salt(16)] + [iv(16)] + [tag(16)] + [ciphertext]
 */
export function encrypt(plaintext: string, passphrase: string): string {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypts a base64 string produced by encrypt().
 */
export function decrypt(encryptedData: string, passphrase: string): string {
  const data = Buffer.from(encryptedData, 'base64');
  const salt = data.subarray(0, 16);
  const iv = data.subarray(16, 32);
  const tag = data.subarray(32, 48);
  const ciphertext = data.subarray(48);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Generates a random machine token for authentication.
 */
export function generateMachineToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
