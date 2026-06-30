const cron = require('node-cron');
const { update, log } = require('./db');
const { runAutoReplyCycle } = require('./auto-reply');

let scheduledTask = null;
const DEFAULT_SCHEDULER_DAYS = [1, 4];
const DEFAULT_SCHEDULER_TIME = '08:00';

function normalizeSchedulerDays(schedulerDays) {
    const rawDays = Array.isArray(schedulerDays) && schedulerDays.length > 0
        ? schedulerDays
        : DEFAULT_SCHEDULER_DAYS;
    const days = rawDays.map(Number);
    if (days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
        throw new Error('scheduler_days must be an array of weekday numbers from 0 (Sun) to 6 (Sat)');
    }
    return [...new Set(days)];
}

function parseSchedulerTime(schedulerTime) {
    const time = String(schedulerTime || DEFAULT_SCHEDULER_TIME).trim();
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
    if (!match) {
        throw new Error('scheduler_time must be HH:mm in 24-hour format');
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return {
        hour,
        minute,
        value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    };
}

function buildCronExpression(schedulerDays, schedulerTime) {
    const days = normalizeSchedulerDays(schedulerDays);
    const time = parseSchedulerTime(schedulerTime);
    return `${time.minute} ${time.hour} * * ${days.join(',')}`;
}

function getNextRunInfo(schedulerDays, schedulerTime) {
    const days = normalizeSchedulerDays(schedulerDays);
    const { hour, minute } = parseSchedulerTime(schedulerTime);
    const now = new Date();

    for (let i = 0; i < 7; i++) {
        const candidate = new Date(now);
        candidate.setDate(now.getDate() + i);
        candidate.setHours(hour, minute, 0, 0);
        if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
        if (days.includes(candidate.getDay())) {
            return candidate;
        }
    }
    return null;
}

function start(schedulerDays, schedulerTime) {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }

    const days = normalizeSchedulerDays(schedulerDays);
    const time = parseSchedulerTime(schedulerTime);
    const cronExpr = buildCronExpression(days, time.value);

    if (!cron.validate(cronExpr)) {
        throw new Error(`Invalid cron expression generated from scheduler config: ${cronExpr}`);
    }

    console.log(`[Scheduler] Cron expression: ${cronExpr}`);
    console.log(`[Scheduler] Next run: ${getNextRunInfo(days, time.value)}`);

    scheduledTask = cron.schedule(cronExpr, () => {
        console.log('[Scheduler] Triggering scheduled auto-reply cycle...');
        update(store => {
            const now = new Date();
            const today = now.toISOString().split('T')[0];
            if (store.scheduler.runs_today_date !== today) {
                store.scheduler.runs_today = 0;
                store.scheduler.runs_today_date = today;
            }
            store.scheduler.last_pull = now.toISOString();
        });
        runAutoReplyCycle();
    }, {
        timezone: 'America/Los_Angeles'
    });

    console.log('[Scheduler] Started — days', days.join(','), 'at', time.value, 'PT');
    return scheduledTask;
}

function stop() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        console.log('[Scheduler] Stopped');
    }
}

module.exports = {
    start,
    stop,
    getNextRunInfo,
    normalizeSchedulerDays,
    parseSchedulerTime,
    buildCronExpression,
};
