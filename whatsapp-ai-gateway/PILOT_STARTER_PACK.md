# Pilot Starter Pack

Generated: 2026-06-25 05:29:35 PDT

## Employee Guide

Use WhatsApp in your kitchen log group.

1. Type `/agent`
2. Read the checklist the bot sends.
3. Enter the 19 temperatures in order.
4. Review the summary.
5. Reply `1` to save.

If something is wrong:

```text
2 = Edit
3 = Re-enter
4 = Cancel
```

## Manager Guide

Before shift:

1. Confirm the team is using the correct WhatsApp group:
   - B1 Kitchen Log
   - B2 Kitchen Log
   - B3 Kitchen Log
2. Confirm the kitchen poster shows the 19 temperatures in the same order as `/agent`.
3. Confirm employees know the only command is `/agent`.

During shift:

1. Employee sends `/agent`.
2. Employee enters temperatures.
3. Employee confirms with `1`.
4. Manager checks dashboard for the submission.
5. Manager checks Google Sheet if dashboard review is needed.

If data does not appear:

1. Check the dashboard connection status.
2. Check whether the employee confirmed with `1`.
3. Check PM2 status for `food-safety-bot`.
4. Check Sheet retry queue if Google Sheet sync is delayed.

## Quick Reference Card

```text
FOOD SAFETY BOT

Start:
/agent

After entering temperatures:
1 = Confirm
2 = Edit
3 = Re-enter
4 = Cancel

Use numbers only.
Enter all 19 temperatures in order.
Do not send photos for this pilot workflow.
```

## WhatsApp Command Guide

| Command | Meaning |
| --- | --- |
| `/agent` | Start the kitchen temperature checklist |
| `1` | Confirm and save the record |
| `2` | Edit one value before saving |
| `3` | Re-enter the full list |
| `4` | Cancel the pending record |

## Pilot Readiness Checklist

| Item | Status |
| --- | --- |
| PM2 service online | PASS |
| WhatsApp connected | PASS |
| B1/B2/B3 groups visible | PASS |
| Google Sheet configured | PASS |
| Dashboard reachable | PASS |
| Live B1/B2/B3 workflow evidence | BLOCKED |

Do not start the pilot until B1, B2, and B3 each complete one live employee-originated `/agent` workflow and the records are visible in DB, Google Sheet, and Dashboard.

