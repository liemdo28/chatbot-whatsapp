import { AgentOsClient, HeartbeatPayload } from '../api/agent-os-client';
import { DashboardClient } from '../api/dashboard-client';
import { MachineIdentity, updateMachineQuickBooksVersion } from './machine-id';
import { detectQuickBooksStatus } from '../quickbooks/detector';
import { getQueueDepth } from '../storage/local-db';
import { logger } from '../storage/logs';

export async function sendHeartbeat(identity: MachineIdentity): Promise<HeartbeatPayload> {
  const qb = detectQuickBooksStatus();
  updateMachineQuickBooksVersion(qb.version);

  const payload: HeartbeatPayload = {
    agent: process.env.AGENT_NAME || 'qb-ops-agent',
    machine_id: identity.machine_id,
    hostname: identity.hostname,
    status: 'online',
    quickbooks: {
      installed: qb.installed,
      running: qb.running,
      version: qb.version,
    },
    timestamp: new Date().toISOString(),
  };

  const agentOs = new AgentOsClient(identity.token);
  const dashboard = new DashboardClient(identity.token);

  try {
    await agentOs.sendHeartbeat(payload);
  } catch {
    // queued by AgentOsClient
  }

  await dashboard.sendMachineStatus({
    agent: payload.agent,
    machine_id: payload.machine_id,
    hostname: payload.hostname,
    online: true,
    quickbooks_installed: payload.quickbooks.installed,
    quickbooks_running: payload.quickbooks.running,
    quickbooks_version: payload.quickbooks.version,
    heartbeat_at: payload.timestamp,
  });

  logger.info('Heartbeat cycle complete', {
    machine_id: identity.machine_id,
    queue_depth: getQueueDepth(),
  });

  return payload;
}
