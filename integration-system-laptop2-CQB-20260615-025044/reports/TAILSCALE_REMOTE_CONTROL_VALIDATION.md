# TAILSCALE REMOTE CONTROL VALIDATION

**Report Date:** 2026-06-05 16:32 UTC+7  
**Status:** WARNING — PC path validated, Mac and iPhone offline.  
**Required Devices:** Mac, PC, iPhone

## Tailscale Status

```text
100.118.102.113  liemdo-pc        liemdo28@  windows  -
100.117.1.73     dos-macbook-air  liemdo28@  macOS    offline, last seen 6d ago
100.123.168.74   iphone-15-plus   liemdo28@  iOS      offline, last seen 4d ago

Health check:
- Tailscale failed to set the DNS configuration of your device: Access is denied.
- Access is denied.
```

## Device Matrix

| Device | Tailscale IP | Status | Validation |
|---|---:|---|---|
| PC `liemdo-pc` | `100.118.102.113` | ONLINE | PASS |
| Mac `dos-macbook-air` | `100.117.1.73` | OFFLINE | FAIL |
| iPhone `iphone-15-plus` | `100.123.168.74` | OFFLINE | FAIL |

## Required Path Validation

| Path | Status | Evidence |
|---|---|---|
| QB Agent → Agent-Coding | PASS on PC loopback/Tailscale IP | `reports/TAILSCALE_REAL_WORLD_VALIDATION.md` |
| Agent-Coding → QB Agent | PASS on PC loopback/Tailscale IP | command lifecycle `test-cmd-1780647850` completed |
| Mac participation | FAIL | Device offline |
| iPhone participation | FAIL | Device offline |

## Remote Command Evidence

From prior real-world Tailscale validation:

```text
Server: http://100.118.102.113:49299
Command: TEST_QB_CONNECTION
Command ID: test-cmd-1780647850
Result: COMPLETED
```

Validated operations:

| Operation | Status |
|---|---|
| Heartbeat POST | PASS |
| Activity log result POST | PASS |
| Command poll GET | PASS |
| Command result POST | PASS |
| Outbox client tests | PASS via 471/471 Python suite |
| QB Agent client tests | PASS via 471/471 Python suite |

## Blocker

Full acceptance requires Mac and iPhone online at the same time as the PC. Current validation cannot be upgraded to full production readiness because two required devices are offline.

