import os from 'os';
import { machineIdSync } from 'node-machine-id';
import { v5 as uuidv5 } from 'uuid';
import { getOrCreateMachineToken } from '../security/token';
import { getSetting, setSetting, upsertMachine, MachineRecord } from '../storage/local-db';

const MACHINE_NAMESPACE = '9d6d6c9a-6c96-4935-b67d-96795f2b63a7';
const AGENT_VERSION = '1.0.0';

export interface MachineIdentity {
  machine_id: string;
  hostname: string;
  windows_username: string | null;
  os_version: string;
  ip_address: string | null;
  agent_version: string;
  token: string;
}

function detectPrimaryIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const net of Object.values(interfaces)) {
    if (!net) continue;
    for (const iface of net) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

export function getMachineIdentity(): MachineIdentity {
  const saved = getSetting('machine_id');
  const hostname = os.hostname();
  const username = process.env.USERNAME || process.env.USER || null;
  const rawMachineId = machineIdSync(true);
  const stableMachineId = saved || uuidv5(`${hostname}:${rawMachineId}`, MACHINE_NAMESPACE);
  if (!saved) setSetting('machine_id', stableMachineId);
  const token = getOrCreateMachineToken();

  const identity: MachineIdentity = {
    machine_id: stableMachineId,
    hostname,
    windows_username: username,
    os_version: `${os.type()} ${os.release()}`,
    ip_address: detectPrimaryIp(),
    agent_version: AGENT_VERSION,
    token,
  };

  const now = new Date().toISOString();
  const machineRecord: MachineRecord = {
    machine_id: identity.machine_id,
    hostname: identity.hostname,
    windows_username: identity.windows_username,
    os_version: identity.os_version,
    ip_address: identity.ip_address,
    agent_version: identity.agent_version,
    quickbooks_version: null,
    registered_at: getSetting('registered_at') || now,
    last_seen_at: now,
    status: 'online',
  };

  if (!getSetting('registered_at')) setSetting('registered_at', now);
  upsertMachine(machineRecord);

  return identity;
}

export function getMachineId(): string {
  return getMachineIdentity().machine_id;
}

export function updateMachineQuickBooksVersion(version: string | null): void {
  const identity = getMachineIdentity();
  const registeredAt = getSetting('registered_at') || new Date().toISOString();
  upsertMachine({
    machine_id: identity.machine_id,
    hostname: identity.hostname,
    windows_username: identity.windows_username,
    os_version: identity.os_version,
    ip_address: identity.ip_address,
    agent_version: identity.agent_version,
    quickbooks_version: version,
    registered_at: registeredAt,
    last_seen_at: new Date().toISOString(),
    status: 'online',
  });
}
