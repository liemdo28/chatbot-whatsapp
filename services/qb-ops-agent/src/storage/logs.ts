import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = process.env.LOG_DIR || './logs';
const logLevel = process.env.LOG_LEVEL || 'info';

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // SECURITY: Never log sensitive financial data or credentials
    const safeMeta = sanitizeLogMeta(meta);
    const metaStr = Object.keys(safeMeta).length ? ` ${JSON.stringify(safeMeta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  })
);

/**
 * Strip sensitive fields from log metadata.
 * Never logs passwords, tokens, transaction amounts, or account numbers.
 */
function sanitizeLogMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = [
    'password', 'passwd', 'token', 'secret', 'credential',
    'ssn', 'account_number', 'card_number', 'cvv', 'routing_number',
    'amount', 'balance', 'transaction_id',
  ];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k))) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      result[key] = sanitizeLogMeta(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'agent.log'),
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

export default logger;
