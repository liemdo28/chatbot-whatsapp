# Toast Mi-core and Google Sheet Event Validation

Date: 2026-06-10

## Required Events

- `TOAST_DOWNLOAD_STARTED`
- `TOAST_BROWSER_USE_STARTED`
- `TOAST_BROWSER_USE_COMPLETED`
- `TOAST_REPORT_VALIDATED`
- `TOAST_HUMAN_REQUIRED`
- `TOAST_REPORT_INVALID`

## Implemented Source Behavior

`desktop-app/services/toast_download_orchestrator.py` emits Toast download events through the supplied Mi-core client.

Unit test proof:

```text
tests/test_toast_download_orchestrator.py::test_mi_core_event_emitted
```

Confirmed by full test run:

```text
489 passed in 16.83s
```

## Live Mi-core Proof

```text
NOT RUN
```

Reason:

No live Toast download was executed from this workspace, so no live Mi-core Toast event was sent.

## Google Sheet Proof

```text
NOT RUN
```

Reason:

The laptop should send events to Mi-core. The Google Sheet `Toast Downloads` row should be written by Mi-core/Agent-Coding centralized reporting. This source-side change proves event emission path but does not prove the server-side Sheet row.

## Verdict

```text
PASS WITH WARNINGS
```

Remaining proof needed:

- Mi-core receives a real event.
- Google Sheet tab `Toast Downloads` receives a row with required columns.
