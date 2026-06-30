import 'dotenv/config';
import { startQbwcServer } from './soap/qbwc-server';
import { onStartup, onShutdown } from './agent/startup';
import { getMachineIdentity } from './agent/machine-id';
import { sendHeartbeat } from './agent/heartbeat';
import { syncConfiguredCompanyFiles, getTrackedCompanyFiles } from './quickbooks/company-files';
import { runAllPhase1Workflows, WorkflowResult } from './quickbooks/workflows';
import { AgentOsClient, WorkflowResultPayload } from './api/agent-os-client';
import { DashboardClient } from './api/dashboard-client';
import { insertWorkflowRun, completeWorkflowRun, logAction, closeDb } from './storage/local-db';
import { logger } from './storage/logs';

const HEARTBEAT_INTERVAL_MS = (parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS || '60', 10)) * 1000;
const WORKFLOW_INTERVAL_MS = (parseInt(process.env.WORKFLOW_CHECK_INTERVAL_MINUTES || '15', 10)) * 60 * 1000;
const COMMAND_POLL_INTERVAL_MS = (parseInt(process.env.COMMAND_POLL_INTERVAL_SECONDS || '60', 10)) * 1000;

const MI_CORE_URL = process.env.MI_CORE_URL || 'http://localhost:4001';
const MI_CORE_API_KEY = process.env.MI_CORE_API_KEY || '';
const MACHINE_ID = process.env.MACHINE_ID || 'qb-laptop-01';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let workflowTimer: ReturnType<typeof setInterval> | null = null;
let commandPollTimer: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;

async function heartbeatCycle(): Promise<void> {
  if (isShuttingDown) return;
  try {
    const identity = getMachineIdentity();
    await sendHeartbeat(identity);
  } catch (err) {
    logger.error('Heartbeat cycle failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function workflowCycle(): Promise<void> {
  if (isShuttingDown) return;
  try {
    const identity = getMachineIdentity();
    syncConfiguredCompanyFiles(identity.machine_id);
    const companyFiles = getTrackedCompanyFiles(identity.machine_id);

    if (!companyFiles.length) {
      logger.info('No company files configured — skipping workflow cycle');
      return;
    }

    for (const cf of companyFiles) {
      const runId = insertWorkflowRun({
        workflow_name: 'all_phase1',
        company_file_id: cf.company_file_id,
        machine_id: identity.machine_id,
        status: 'running',
        started_at: new Date().toISOString(),
      });

      let overallStatus = 'success';
      const allActions: WorkflowResult['actions'] = [];

      try {
        const results = await runAllPhase1Workflows(cf);

        for (const result of results) {
          if (result.status === 'failed') overallStatus = 'failed';
          else if (result.status === 'warning' && overallStatus !== 'failed') overallStatus = 'warning';
          else if (result.status === 'needs_user' && overallStatus === 'success') overallStatus = 'needs_user';

          for (const action of result.actions) {
            allActions.push(action);
            logAction({
              machine_id: identity.machine_id,
              workflow: result.workflow,
              action_name: action.name,
              status: action.status,
              message: action.message,
              created_at: action.timestamp,
            });
          }

          const agentOs = new AgentOsClient(identity.token);
          const wfPayload: WorkflowResultPayload = {
            agent: process.env.AGENT_NAME || 'qb-ops-agent',
            machine_id: identity.machine_id,
            company_file: result.company_file,
            workflow: result.workflow,
            status: result.status,
            actions: result.actions,
          };
          await agentOs.sendWorkflowResult(wfPayload).catch(() => {});

          const dashboard = new DashboardClient(identity.token);
          await dashboard.sendWorkflowStatus({
            agent: process.env.AGENT_NAME || 'qb-ops-agent',
            machine_id: identity.machine_id,
            company_file_id: cf.company_file_id,
            company_name: cf.company_name,
            company_file_path: cf.company_file_path,
            workflow: result.workflow,
            status: result.status,
            last_check_at: new Date().toISOString(),
            action_required: result.status === 'needs_user' || result.status === 'failed',
            summary: result.actions.map(a => a.message).join(' | '),
          }).catch(() => {});
        }
      } catch (err) {
        overallStatus = 'failed';
        logger.error('Workflow cycle failed for company file', {
          company_file: cf.company_file_path,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      completeWorkflowRun(
        runId,
        overallStatus,
        `${overallStatus}: ${allActions.length} actions`,
        JSON.stringify(allActions)
      );

      logger.info('Workflow cycle complete for company file', {
        company_file: cf.company_file_path,
        status: overallStatus,
        actions: allActions.length,
      });
    }

    // Flush queued items
    const agentOs = new AgentOsClient(identity.token);
    await agentOs.flushQueue().catch(() => {});
  } catch (err) {
    logger.error('Workflow cycle failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

interface QbCommand {
  command_id: string;
  machine_id: string;
  command_type: string;
  payload_json: string;
  status: string;
  created_at: string;
}

async function miCoreFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (MI_CORE_API_KEY) headers['X-API-Key'] = MI_CORE_API_KEY;
  return fetch(`${MI_CORE_URL}${path}`, { ...options, headers: { ...headers, ...(options.headers as Record<string, string> || {}) } });
}

async function executeTriggerSync(cmd: QbCommand): Promise<void> {
  const identity = getMachineIdentity();
  const companyFiles = getTrackedCompanyFiles(identity.machine_id);

  if (!companyFiles.length) {
    logger.warn('[CMD] TRIGGER_SYNC: no company files configured, skipping');
    return;
  }

  logger.info('[CMD] TRIGGER_SYNC: starting forced sync', { command_id: cmd.command_id, files: companyFiles.length });
  await workflowCycle();
  logger.info('[CMD] TRIGGER_SYNC: done', { command_id: cmd.command_id });
}

async function commandPollCycle(): Promise<void> {
  if (isShuttingDown) return;
  try {
    const res = await miCoreFetch(`/api/qb-agent/commands?machine_id=${encodeURIComponent(MACHINE_ID)}`);
    if (!res.ok) {
      logger.warn('[CMD] Poll failed', { status: res.status });
      return;
    }
    const { commands } = await res.json() as { commands: QbCommand[] };
    if (!commands?.length) return;

    for (const cmd of commands) {
      logger.info('[CMD] Processing command', { command_id: cmd.command_id, type: cmd.command_type });

      // Ack first so we don't re-process on next poll
      await miCoreFetch(`/api/qb-agent/commands/${cmd.command_id}/ack`, { method: 'POST' }).catch(() => {});

      try {
        if (cmd.command_type === 'TRIGGER_SYNC') {
          await executeTriggerSync(cmd);
          await miCoreFetch(`/api/qb-agent/commands/${cmd.command_id}/result`, {
            method: 'POST',
            body: JSON.stringify({ status: 'completed', result: { triggered_by: 'qb-ops-agent', ts: new Date().toISOString() } }),
          });
        } else {
          logger.warn('[CMD] Unknown command type — skipping', { type: cmd.command_type });
          await miCoreFetch(`/api/qb-agent/commands/${cmd.command_id}/result`, {
            method: 'POST',
            body: JSON.stringify({ status: 'error', error: `unknown command type: ${cmd.command_type}` }),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[CMD] Command execution failed', { command_id: cmd.command_id, error: message });
        await miCoreFetch(`/api/qb-agent/commands/${cmd.command_id}/result`, {
          method: 'POST',
          body: JSON.stringify({ status: 'error', error: message }),
        }).catch(() => {});
      }
    }
  } catch (err) {
    logger.error('[CMD] Command poll error', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function main(): Promise<void> {
  await onStartup();

  // Start QBWC SOAP server (port 3457)
  startQbwcServer();

  // Initial runs
  await heartbeatCycle();
  await workflowCycle();
  await commandPollCycle();

  // Schedule recurring
  heartbeatTimer = setInterval(heartbeatCycle, HEARTBEAT_INTERVAL_MS);
  workflowTimer = setInterval(workflowCycle, WORKFLOW_INTERVAL_MS);
  commandPollTimer = setInterval(commandPollCycle, COMMAND_POLL_INTERVAL_MS);

  logger.info('qb-ops-agent running', {
    heartbeatInterval: HEARTBEAT_INTERVAL_MS,
    workflowInterval: WORKFLOW_INTERVAL_MS,
    commandPollInterval: COMMAND_POLL_INTERVAL_MS,
    miCoreUrl: MI_CORE_URL,
    machineId: MACHINE_ID,
  });
}

process.on('SIGINT', async () => {
  logger.info('Received SIGINT');
  isShuttingDown = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (workflowTimer) clearInterval(workflowTimer);
  if (commandPollTimer) clearInterval(commandPollTimer);
  await onShutdown();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM');
  isShuttingDown = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (workflowTimer) clearInterval(workflowTimer);
  await onShutdown();
  closeDb();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  closeDb();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  closeDb();
  process.exit(1);
});

main().catch((err) => {
  logger.error('Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  closeDb();
  process.exit(1);
});
