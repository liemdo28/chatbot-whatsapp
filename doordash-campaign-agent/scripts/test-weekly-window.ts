import assert from 'node:assert/strict';
import { createWeeklyReportingWindow, getCompletedWeeklyReportingWindow } from '../src/automation/weekly-reporting-window.js';

const explicit = createWeeklyReportingWindow('America/Los_Angeles', '2026-08-03', '2026-08-10');
assert.equal(explicit.weekStart, '2026-08-03');
assert.equal(explicit.weekEndExclusive, '2026-08-10');
assert.equal(explicit.label, '08/03/2026 - 08/10/2026');

const completed = getCompletedWeeklyReportingWindow('Asia/Ho_Chi_Minh', new Date('2026-08-14T06:00:00.000Z'));
assert.equal(completed.weekStart, '2026-08-03');
assert.equal(completed.weekEndExclusive, '2026-08-10');

console.log('weekly-window tests passed');
