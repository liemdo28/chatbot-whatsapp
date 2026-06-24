import { logger } from '../storage/logs';

export async function onStartup(): Promise<void> {
  logger.info('qb-ops-agent starting up', {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    uptime: process.uptime(),
  });
}

export async function onShutdown(): Promise<void> {
  logger.info('qb-ops-agent shutting down gracefully', { uptime: process.uptime() });
}
