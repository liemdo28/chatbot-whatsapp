# TEST FAILURE INVENTORY

**Report Date:** 2026-06-05 16:32 UTC+7  
**Directive Baseline:** PASS WITH WARNINGS, 461/471 PASS, 10 failing blockers  
**Current Verified Status:** 471/471 Python PASS and 562/562 Agent-Coding PASS  
**Verdict:** All 10 inventoried blockers have been closed in this workspace.

## Verification

```text
Python integration-system suite:
471 passed in 50.05s

Agent-Coding Node suite:
562 pass
0 fail
0 cancelled
duration_ms 15633.5126
```

Evidence:
- `reports/evidence/pytest-redirect.out`
- Agent-Coding command: `node --test tests/*.test.js`

## Individual Failure Inventory

### Failure 1

| Field | Value |
|---|---|
| Test Name | `ExecutionSandbox.runs a simple command` |
| File | `Agent-Coding/tests/aos-runtime.test.js:101` |
| Failure Message | `AssertionError: -1 !== 0` |
| Root Cause | `ExecutionSandbox` spawned `sh -c`, which is not available in the Windows runtime used here. |
| Code Defect / Test Defect / Environment Defect | Code Defect |
| Severity | HIGH |
| Can affect production? | YES |
| Fix Required? | YES, completed |
| ETA | Completed 2026-06-05 |

### Failure 2

| Field | Value |
|---|---|
| Test Name | `ExecutionSandbox.enforces timeout` |
| File | `Agent-Coding/tests/aos-runtime.test.js:119` |
| Failure Message | `AssertionError: undefined !== true` |
| Root Cause | Timeout command used Windows-incompatible shell execution path. |
| Code Defect / Test Defect / Environment Defect | Code Defect |
| Severity | HIGH |
| Can affect production? | YES |
| Fix Required? | YES, completed |
| ETA | Completed 2026-06-05 |

### Failure 3

| Field | Value |
|---|---|
| Test Name | `ExecutionSandbox.tracks stats` |
| File | `Agent-Coding/tests/aos-runtime.test.js:127` |
| Failure Message | `AssertionError: 0 !== 1` |
| Root Cause | Successful command never executed because shell spawn failed first. |
| Code Defect / Test Defect / Environment Defect | Code Defect |
| Severity | MEDIUM |
| Can affect production? | YES |
| Fix Required? | YES, completed |
| ETA | Completed 2026-06-05 |

### Failure 4

| Field | Value |
|---|---|
| Test Name | `ExecutionTimeline.should record typed events` |
| File | `Agent-Coding/tests/cognition.test.js:273` |
| Failure Message | `AssertionError: 0 !== 1` |
| Root Cause | Timeline stat updater checked singular event types while stats fields are plural (`builds`, `failures`, `patches`, `rollbacks`). |
| Code Defect / Test Defect / Environment Defect | Code Defect |
| Severity | MEDIUM |
| Can affect production? | YES |
| Fix Required? | YES, completed |
| ETA | Completed 2026-06-05 |

### Failure 5

| Field | Value |
|---|---|
| Test Name | `integrity.test.js file-level import` |
| File | `Agent-Coding/tests/integrity.test.js:1` |
| Failure Message | `ERR_MODULE_NOT_FOUND: Cannot find package 'fast-glob'` |
| Root Cause | Agent-Coding dependencies were not installed in the recovered workspace. |
| Code Defect / Test Defect / Environment Defect | Environment Defect |
| Severity | HIGH |
| Can affect production? | YES |
| Fix Required? | YES, completed with `npm install` |
| ETA | Completed 2026-06-05 |

### Failure 6

| Field | Value |
|---|---|
| Test Name | `DatabaseCivilization.should report stats` |
| File | `Agent-Coding/tests/live-runtime.test.js:154` |
| Failure Message | `assert.ok(stats.tables.length > 0)` |
| Root Cause | `better-sqlite3` dependency was missing, causing DB fallback to `none`. |
| Code Defect / Test Defect / Environment Defect | Environment Defect |
| Severity | MEDIUM |
| Can affect production? | YES |
| Fix Required? | YES, completed with `npm install` |
| ETA | Completed 2026-06-05 |

### Failure 7

| Field | Value |
|---|---|
| Test Name | `PersistentMemory.should record executions` |
| File | `Agent-Coding/tests/live-runtime.test.js:186` |
| Failure Message | `assert.ok(ctx.executions.length >= 1)` |
| Root Cause | DB was unavailable because dependencies were missing. |
| Code Defect / Test Defect / Environment Defect | Environment Defect |
| Severity | MEDIUM |
| Can affect production? | YES |
| Fix Required? | YES, completed |
| ETA | Completed 2026-06-05 |

### Failure 8

| Field | Value |
|---|---|
| Test Name | `PersistentMemory.should search memory` |
| File | `Agent-Coding/tests/live-runtime.test.js:194` |
| Failure Message | `assert.ok(results.length >= 1)` |
| Root Cause | DB-backed memory search could not run without installed SQLite dependency. |
| Code Defect / Test Defect / Environment Defect | Environment Defect |
| Severity | MEDIUM |
| Can affect production? | YES |
| Fix Required? | YES, completed |
| ETA | Completed 2026-06-05 |

### Failure 9

| Field | Value |
|---|---|
| Test Name | `live-runtime.test.js file-level cancellation` |
| File | `Agent-Coding/tests/live-runtime.test.js:1` |
| Failure Message | `Promise resolution is still pending but the event loop has already resolved` and later OOM during ingestion |
| Root Cause | `IngestionEngine.#chunkFixed()` could loop forever on final chunks because `start = end - overlap` never advanced past EOF. |
| Code Defect / Test Defect / Environment Defect | Code Defect |
| Severity | CRITICAL |
| Can affect production? | YES |
| Fix Required? | YES, completed |
| ETA | Completed 2026-06-05 |

### Failure 10

| Field | Value |
|---|---|
| Test Name | `omega-ascension.test.js file-level import` |
| File | `Agent-Coding/tests/omega-ascension.test.js:1` |
| Failure Message | `ERR_MODULE_NOT_FOUND: Cannot find module ... OmegaMetasystem.js` |
| Root Cause | `src/core/omega-ascension/OmegaMetasystem.js` was missing. |
| Code Defect / Test Defect / Environment Defect | Code Defect |
| Severity | HIGH |
| Can affect production? | YES |
| Fix Required? | YES, completed |
| ETA | Completed 2026-06-05 |

## Fix Summary

| Area | Fix |
|---|---|
| Execution sandbox | Use PowerShell on Windows and `sh` on POSIX. |
| Timeline stats | Map singular event types to plural stat keys. |
| Agent-Coding dependencies | Installed npm dependencies. |
| Cognition runtime | Added bounded timeouts for Ollama calls. |
| Filesystem watcher | Made watcher non-persistent by default to prevent test runner hangs. |
| Ingestion engine | Fixed final chunk loop termination. |
| Omega metasystem | Added missing `OmegaMetasystem` implementation. |

