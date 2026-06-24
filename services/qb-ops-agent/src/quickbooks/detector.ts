import { execSync } from 'child_process';
import { logger } from '../storage/logs';

export interface QuickBooksStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  processName: string | null;
}

function safeExec(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    logger.debug('Command failed during QuickBooks detection', { command, error: error instanceof Error ? error.message : String(error) });
    return '';
  }
}

export function isQuickBooksRunning(): boolean {
  const output = safeExec('tasklist /FI "IMAGENAME eq QBW32.EXE"');
  return output.toLowerCase().includes('qbw32.exe');
}

export function detectInstalledQuickBooksVersion(): string | null {
  const commands = [
    'reg query "HKLM\\SOFTWARE\\Intuit\\QuickBooks" /s',
    'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Intuit\\QuickBooks" /s',
  ];

  for (const command of commands) {
    const output = safeExec(command);
    if (!output) continue;

    const versionMatch = output.match(/QuickBooks[^\r\n]*?(20\d{2}|Enterprise Solutions \d+\.0|Desktop \d+)/i);
    if (versionMatch) return versionMatch[0].trim();

    const yearMatch = output.match(/(20\d{2})/);
    if (yearMatch) return `QuickBooks ${yearMatch[1]}`;
  }

  const pathChecks = [
    'if exist "C:\\Program Files\\Intuit\\QuickBooks*" echo installed',
    'if exist "C:\\Program Files (x86)\\Intuit\\QuickBooks*" echo installed',
  ];

  for (const command of pathChecks) {
    const output = safeExec(command);
    if (output.toLowerCase().includes('installed')) return 'QuickBooks Desktop (version unknown)';
  }

  return null;
}

export function detectQuickBooksStatus(): QuickBooksStatus {
  const version = detectInstalledQuickBooksVersion();
  const running = isQuickBooksRunning();

  const status: QuickBooksStatus = {
    installed: version !== null,
    running,
    version,
    processName: running ? 'QBW32.EXE' : null,
  };

  logger.info('QuickBooks status detected', {
    installed: status.installed,
    running: status.running,
    version: status.version,
  });

  return status;
}

export function getActiveCompanyFilePathIfPossible(): string | null {
  // Phase 1 note:
  // We intentionally avoid unsafe UI automation.
  // Active company file detection can be improved later via SDK/Web Connector.
  // For now we return null when not safely available.
  return null;
}
