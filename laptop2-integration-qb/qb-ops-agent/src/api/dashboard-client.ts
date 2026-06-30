import axios, { AxiosInstance } from 'axios';
import { logger } from '../storage/logs';

const baseURL = process.env.DASHBOARD_API_URL || 'https://dashboard.bakudanramen.com/api';

export interface DashboardMachineStatusPayload {
  agent: string;
  machine_id: string;
  hostname: string;
  online: boolean;
  quickbooks_installed: boolean;
  quickbooks_running: boolean;
  quickbooks_version: string | null;
  heartbeat_at: string;
}

export interface DashboardWorkflowStatusPayload {
  agent: string;
  machine_id: string;
  company_file_id: string;
  company_name: string | null;
  company_file_path: string;
  workflow: string;
  status: string;
  last_check_at: string;
  action_required: boolean;
  summary: string;
}

export class DashboardClient {
  private readonly http: AxiosInstance;

  constructor(machineToken: string) {
    this.http = axios.create({
      baseURL,
      timeout: 10_000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${machineToken}`,
      },
    });
  }

  async sendMachineStatus(payload: DashboardMachineStatusPayload): Promise<void> {
    try {
      await this.http.post('/accounting-ops/qb-machines/status', payload);
      logger.info('Dashboard machine status prepared/sent', { machine_id: payload.machine_id, online: payload.online });
    } catch (error) {
      logger.warn('Dashboard machine status send failed', {
        machine_id: payload.machine_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async sendWorkflowStatus(payload: DashboardWorkflowStatusPayload): Promise<void> {
    try {
      await this.http.post('/accounting-ops/qb-workflows/status', payload);
      logger.info('Dashboard workflow status prepared/sent', {
        machine_id: payload.machine_id,
        workflow: payload.workflow,
        status: payload.status,
      });
    } catch (error) {
      logger.warn('Dashboard workflow status send failed', {
        machine_id: payload.machine_id,
        workflow: payload.workflow,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
