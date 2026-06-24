import axios, { AxiosInstance } from 'axios';
import { logger } from '../storage/logs';
import { enqueueOutbound, getQueuedItems, markQueueItemAttempted, removeFromQueue } from '../storage/local-db';

const baseURL = process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3456/api';

export interface HeartbeatPayload {
  agent: string;
  machine_id: string;
  hostname: string;
  status: 'online' | 'offline';
  quickbooks: {
    installed: boolean;
    running: boolean;
    version: string | null;
  };
  timestamp: string;
}

export interface WorkflowActionResult {
  name: string;
  status: 'done' | 'missing' | 'failed' | 'needs_user';
  message: string;
  timestamp: string;
}

export interface WorkflowResultPayload {
  agent: string;
  machine_id: string;
  company_file: string;
  workflow: string;
  status: 'success' | 'warning' | 'failed' | 'needs_user';
  actions: WorkflowActionResult[];
}

export class AgentOsClient {
  private readonly http: AxiosInstance;
  private readonly agentName: string;
  private readonly machineToken: string;

  constructor(machineToken: string) {
    this.machineToken = machineToken;
    this.agentName = process.env.AGENT_NAME || 'qb-ops-agent';
    this.http = axios.create({
      baseURL,
      timeout: 10_000,
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Name': this.agentName,
        'Authorization': `Bearer ${machineToken}`,
      },
    });
  }

  async sendHeartbeat(payload: HeartbeatPayload): Promise<void> {
    try {
      await this.http.post('/agents/heartbeat', payload);
      logger.info('Heartbeat sent to Agent OS', { machine_id: payload.machine_id, status: payload.status });
    } catch (error) {
      logger.warn('Failed to send heartbeat to Agent OS, queueing for retry', {
        machine_id: payload.machine_id,
        error: error instanceof Error ? error.message : String(error),
      });
      enqueueOutbound(payload, '/agents/heartbeat');
      throw error;
    }
  }

  async sendWorkflowResult(payload: WorkflowResultPayload): Promise<void> {
    try {
      await this.http.post('/agents/workflow-result', payload);
      logger.info('Workflow result sent to Agent OS', {
        machine_id: payload.machine_id,
        workflow: payload.workflow,
        status: payload.status,
      });
    } catch (error) {
      logger.warn('Failed to send workflow result to Agent OS, queueing for retry', {
        machine_id: payload.machine_id,
        workflow: payload.workflow,
        error: error instanceof Error ? error.message : String(error),
      });
      enqueueOutbound(payload, '/agents/workflow-result');
      throw error;
    }
  }

  async flushQueue(): Promise<void> {
    const items = getQueuedItems(50);
    if (!items.length) return;

    logger.info('Flushing outbound queue', { queuedItems: items.length });

    for (const item of items) {
      try {
        await this.http.post(item.endpoint, JSON.parse(item.payload));
        removeFromQueue(item.id);
        logger.info('Queued payload delivered successfully', { queueId: item.id, endpoint: item.endpoint });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        markQueueItemAttempted(item.id, message);
        logger.warn('Queued payload delivery failed', { queueId: item.id, endpoint: item.endpoint, error: message });
      }
    }
  }
}
