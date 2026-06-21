# Project Overlap Audit
**Generated:** 2026-06-09  
**Auditor:** Dev (CEO Directive)

---

## All Relevant Projects Found Under E:\Project\Master

### 1. `E:\Project\Master\mi-core`
| Field | Value |
|---|---|
| **Path** | `E:\Project\Master\mi-core` |
| **Repo URL** | local |
| **Branch** | `feature/option-b-form-photo-workflow` |
| **Commit** | `e06e26c` |
| **Purpose** | Central dashboard, AI assistant, remote API, command hub. Now also hosts QB Agent API (`/api/qb-agent/*`). |
| **Active?** | ✅ YES |
| **Duplicate?** | ❌ NO — canonical central server |
| **Is old Agent-Coding?** | ❌ NO |
| **Is Mi-core?** | ✅ YES — this is the canonical Mi-core |
| **Is QB Agent?** | Partial — hosts QB Agent endpoints (server-side) |
| **Verdict** | **KEEP — this is the canonical Mi-core** |

---

### 2. `E:\Project\Master\Bakudan\integration-system`
| Field | Value |
|---|---|
| **Path** | `E:\Project\Master\Bakudan\integration-system` |
| **Branch** | `main` |
| **Commit** | `72ad8c5` |
| **Purpose** | Windows desktop/background app. QB read-only activity log + QB write sync (disabled by default). Installs as ToastPOSManager.exe. Communicates with Mi-core. |
| **Active?** | ✅ YES |
| **Duplicate?** | ❌ NO — canonical Windows QB Agent |
| **Is old Agent-Coding?** | ❌ NO |
| **Is Mi-core?** | ❌ NO |
| **Is QB Agent?** | ✅ YES — this is the canonical Windows QB Agent desktop app |
| **Verdict** | **KEEP — this is the canonical QB Agent** |

---

### 3. `E:\Project\Master\qb-ops-agent`
| Field | Value |
|---|---|
| **Path** | `E:\Project\Master\qb-ops-agent` |
| **Purpose** | Node.js/TypeScript QB monitoring agent. Reports to `AGENT_OS_API_URL` (http://127.0.0.1:3456/api — old/different server). Has workflows: sales-receipt-check, bank-feed-check, reconcile-check, cc-expense-check, daily-accounting-check. |
| **Active?** | ⚠️ UNCLEAR — separate codebase, different server target |
| **Duplicate?** | ⚠️ YES — overlaps functionally with integration-system (QB activity reads) |
| **Is old Agent-Coding?** | ❌ NO |
| **Is Mi-core?** | ❌ NO |
| **Is QB Agent?** | ⚠️ YES but Node.js, reports to DIFFERENT server (not Mi-core) |
| **Verdict** | **⚠️ OVERLAP — CEO decision needed: archive or merge into integration-system/mi-core** |

> **Note:** qb-ops-agent reports to `AGENT_OS_API_URL` (127.0.0.1:3456), which is NOT Mi-core (port 4001). It appears to be connecting to an older "Agent OS" server. This creates a split-brain scenario if both run on the same laptop.

---

### 4. `E:\Project\Master\Bakudan\Agent-Coding`
| Field | Value |
|---|---|
| **Path** | `E:\Project\Master\Bakudan\Agent-Coding` |
| **Branch** | `main` |
| **Commit** | `65a6fb6` |
| **Purpose** | Node.js engineering OS / project registry / review ops dashboard. NOT a QB agent. References other projects. |
| **Active?** | ⚠️ UNCLEAR — may be superseded by Mi-core |
| **Duplicate?** | ⚠️ POSSIBLY — Mi-core appears to replace the "engineering OS" role |
| **Is old Agent-Coding?** | ✅ YES — this is the old Agent-Coding |
| **Is Mi-core?** | ❌ NO |
| **Is QB Agent?** | ❌ NO |
| **Verdict** | **⚠️ ARCHIVE CANDIDATE — CEO decision needed. Old Agent-Coding has been superseded by Mi-core.** |

---

### 5. `E:\Project\Master\.local-agent-global\mi-core` (nested copy)
| Field | Value |
|---|---|
| **Path** | `E:\Project\Master\.local-agent-global\mi-core` |
| **Purpose** | Appears to be a local agent knowledge cache folder, not a separate project |
| **Verdict** | **IGNORE — not a project** |

---

### 6. `E:\Project\Master\accounting-engine`
| Field | Value |
|---|---|
| **Path** | `E:\Project\Master\accounting-engine` |
| **Purpose** | Separate accounting Electron app — not QB agent, not Mi-core |
| **Verdict** | **KEEP — separate system, no overlap** |

---

### 7. `E:\Project\Master\agent-coding-api-keys`
| Field | Value |
|---|---|
| **Path** | `E:\Project\Master\agent-coding-api-keys` |
| **Purpose** | Credentials/keys folder for Agent-Coding era |
| **Verdict** | **REVIEW — may contain stale credentials. Do not delete until keys are migrated to MI_CORE_API_KEY.** |

---

## Summary of CEO Action Required

| Project | Status | CEO Action |
|---|---|---|
| `mi-core` | ✅ Canonical | Keep |
| `integration-system` | ✅ Canonical QB Agent | Keep |
| `qb-ops-agent` | ⚠️ Duplicate (Node.js QB monitor, wrong server target) | Decision: Archive or merge |
| `Agent-Coding` | ⚠️ Old engineering OS | Decision: Archive to `_archive/` |
| `agent-coding-api-keys` | ⚠️ Old credentials | Review and migrate |
