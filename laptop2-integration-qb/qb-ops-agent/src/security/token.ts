import fs from 'fs';
import path from 'path';
import { generateMachineToken } from './encryption';
import { logger } from '../storage/logs';

const TOKEN_FILE = path.join(process.cwd(), '.machine_token');

export function getOrCreateMachineToken(): string {
  if (fs.existsSync(TOKEN_FILE)) {
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (token) return token;
  }
  const token = process.env.MACHINE_TOKEN || generateMachineToken();
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  logger.info('Machine token generated and saved', { tokenFile: TOKEN_FILE });
  return token;
}

export function getMachineToken(): string | null {
  if (process.env.MACHINE_TOKEN) return process.env.MACHINE_TOKEN;
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  return null;
}
