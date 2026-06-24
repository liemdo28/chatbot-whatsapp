/**
 * Simple structured logger for QB Ops Agent
 * Outputs JSON to stdout for pm2/LogDNA compatibility
 */

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

function shouldLog(level) {
    return levels[level] <= (levels[LOG_LEVEL] ?? levels.info);
}

function format(level, message, meta = {}) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        msg: message,
        service: 'qb-ops-agent',
        ...meta,
    };
    return JSON.stringify(entry);
}

const logger = {
    error(message, meta = {}) {
        if (shouldLog('error')) console.error(format('error', message, meta));
    },
    warn(message, meta = {}) {
        if (shouldLog('warn')) console.warn(format('warn', message, meta));
    },
    info(message, meta = {}) {
        if (shouldLog('info')) console.log(format('info', message, meta));
    },
    debug(message, meta = {}) {
        if (shouldLog('debug')) console.log(format('debug', message, meta));
    },
};

module.exports = logger;
