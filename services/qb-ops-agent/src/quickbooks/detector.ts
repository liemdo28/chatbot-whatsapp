import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { logger } from '../storage/logs';

export interface QuickBooksStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  processName: string | null;
}

function safeExecFile(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    logger.debug('Command failed during QuickBooks detection', {
      command: [file, ...args].join(' '),
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

function hasQuickBooksInstallUnder(root: string): boolean {
  try {
    if (!existsSync(root)) return false;
    return readdirSync(root, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() && entry.name.toLowerCase().startsWith('quickbooks')
    );
  } catch (error) {
    logger.debug('QuickBooks path check failed', {
      root,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function isQuickBooksRunning(): boolean {
  const output = safeExecFile('tasklist.exe', ['/FI', 'IMAGENAME eq QBW32.EXE']);
  return output.toLowerCase().includes('qbw32.exe');
}

export function detectInstalledQuickBooksVersion(): string | null {
  const commands = [
    ['query', 'HKLM\\SOFTWARE\\Intuit\\QuickBooks', '/s'],
    ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Intuit\\QuickBooks', '/s'],
  ];

  for (const args of commands) {
    const output = safeExecFile('reg.exe', args);
    if (!output) continue;

    const versionMatch = output.match(/QuickBooks[^\r\n]*?(20\d{2}|Enterprise Solutions \d+\.0|Desktop \d+)/i);
    if (versionMatch) return versionMatch[0].trim();

    const yearMatch = output.match(/(20\d{2})/);
    if (yearMatch) return `QuickBooks ${yearMatch[1]}`;
  }

  const installRoots = [
    'C:\\Program Files\\Intuit',
    'C:\\Program Files (x86)\\Intuit',
  ];

  for (const root of installRoots) {
    if (hasQuickBooksInstallUnder(root)) return 'QuickBooks Desktop (version unknown)';
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
