export interface WeeklyReportingWindow {
    timezone: string;
    weekStart: string;
    weekEndExclusive: string;
    startLabel: string;
    endLabel: string;
    label: string;
}

interface ZonedDateParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
};

function zonedDateParts(date: Date, timeZone: string): ZonedDateParts {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        weekday: 'long',
        hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date);
    const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find((part) => part.type === type)?.value || '';

    return {
        year: Number(lookup('year')),
        month: Number(lookup('month')),
        day: Number(lookup('day')),
        hour: Number(lookup('hour')),
        minute: Number(lookup('minute')),
        second: Number(lookup('second')),
        weekday: WEEKDAY_INDEX[lookup('weekday').toLowerCase()] ?? 0,
    };
}

function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
    const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
    const localizedGuess = new Date(utcGuess.toLocaleString('en-US', { timeZone }));
    const offsetMs = localizedGuess.getTime() - utcGuess.getTime();
    return new Date(utcGuess.getTime() - offsetMs);
}

function shiftIsoDate(isoDate: string, days: number): string {
    const base = new Date(`${isoDate}T00:00:00.000Z`);
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
}

function formatSlashDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    return `${month}/${day}/${year}`;
}

export function getCompletedWeeklyReportingWindow(
    timeZone: string,
    referenceDate: Date = new Date(),
): WeeklyReportingWindow {
    const parts = zonedDateParts(referenceDate, timeZone);
    const localTodayUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const daysSinceMonday = (parts.weekday + 6) % 7;
    const currentWeekStartUtc = new Date(localTodayUtc.getTime() - (daysSinceMonday * 24 * 60 * 60 * 1000));
    const previousWeekStart = new Date(currentWeekStartUtc.getTime() - (7 * 24 * 60 * 60 * 1000));

    const weekStart = previousWeekStart.toISOString().slice(0, 10);
    const weekEndExclusive = currentWeekStartUtc.toISOString().slice(0, 10);

    return {
        timezone: timeZone,
        weekStart,
        weekEndExclusive,
        startLabel: formatSlashDate(weekStart),
        endLabel: formatSlashDate(weekEndExclusive),
        label: `${formatSlashDate(weekStart)} - ${formatSlashDate(weekEndExclusive)}`,
    };
}

export function createWeeklyReportingWindow(
    timeZone: string,
    weekStart: string,
    weekEndExclusive?: string,
): WeeklyReportingWindow {
    const resolvedEnd = weekEndExclusive || shiftIsoDate(weekStart, 7);
    return {
        timezone: timeZone,
        weekStart,
        weekEndExclusive: resolvedEnd,
        startLabel: formatSlashDate(weekStart),
        endLabel: formatSlashDate(resolvedEnd),
        label: `${formatSlashDate(weekStart)} - ${formatSlashDate(resolvedEnd)}`,
    };
}

export function windowScheduledAtUtc(window: WeeklyReportingWindow, hour: number, minute: number): Date {
    const [year, month, day] = window.weekEndExclusive.split('-').map(value => Number(value));
    return zonedDateTimeToUtc(year, month, day, hour, minute, window.timezone);
}
