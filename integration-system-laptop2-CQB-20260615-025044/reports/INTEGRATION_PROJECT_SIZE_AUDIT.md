# Integration-System Project Size Audit
**Date:** 2026-06-09  
**Phase 1 — CEO Directive: Remove Nested Agent-Coding + Clean Project Size**

---

## Original Folder Sizes (Before Cleanup)

| Folder | Size |
|---|---|
| `dist/` | **704 MB** — PyInstaller output, generated |
| `desktop-app/.venv/` | **355 MB** — Python virtual environment, generated |
| `Agent-Coding/` | **123 MB** — WRONG NESTED REPO (separate git project) |
| `build/` | **28 MB** — Generated build artifacts |
| `.pytest_cache/` | **63 KB** — Generated pytest cache |

**Approximate total bloat: ~1.2 GB** from generated/wrong folders

---

## Nested Repos Found

| Path | Type | Remote | Verdict |
|---|---|---|---|
| `integration-system/Agent-Coding/` | Git repo | `github.com/liemdo28/agent-coding.git` | ❌ WRONG — separate project, must be removed |

**Agent-Coding details:**
- Branch: `main`
- Commit: `65a6fb60591f83681e47248f3af0dbc787be9afa`
- Contains: Node.js monorepo with `node_modules/`, `dist/`, multiple sub-packages
- Is NOT imported by any integration-system Python code
- Has no business being inside integration-system

---

## Does Integration-System Import Agent-Coding?

Search results: **NO runtime imports of the Agent-Coding folder path.**

References to "agent-coding" in Python files are:
- Config key backward-compatibility code (`config.get("mi_core") or config.get("agent_coding")`)
- Deprecated client shim (`agent_coding_client.py` → aliases `mi_core_client`)
- Test files testing backward compat

**None reference the `Agent-Coding/` folder path.**

---

## Generated Folders Found

| Pattern | Count | Action |
|---|---|---|
| `node_modules/` | 1 (inside Agent-Coding only) | REMOVED with Agent-Coding |
| `.venv/` | 1 (`desktop-app/.venv/`) | REMOVED |
| `dist/` | 2 (root + `desktop-app/dist/`) | REMOVED |
| `build/` | 1 (root `build/`) | REMOVED |
| `__pycache__/` | Many (throughout .venv + source) | REMOVED |
| `.pytest_cache/` | 1 | REMOVED |

---

## After Cleanup

| Folder | Status |
|---|---|
| `Agent-Coding/` | ✅ Archived to `E:\Project\Master\_archive\integration-system-nested-Agent-Coding-20260609-193828` |
| `dist/` | ✅ Removed (regeneratable via `build_release.ps1`) |
| `build/` | ✅ Removed |
| `desktop-app/.venv/` | ✅ Removed (regeneratable via `pip install -r requirements.txt`) |
| `__pycache__/` | ✅ All removed |
| `.pytest_cache/` | ✅ Removed |

**Estimated size reduction: ~1.2 GB**

---

## .gitignore Updated

Added blocks for:
- `Agent-Coding/`, `agent-coding/`, `mi-core/` — nested project prevention
- `node_modules/`, `dist/`, `build/`, `release/*.zip` — build artifacts
- `runtime/`, `logs/`, `*.db` — runtime data
- `__pycache__/`, `*.pyc`, `.pytest_cache/`, `coverage/` — Python cache

**Installer source intentionally NOT ignored:**
- `installer/` ✅ tracked
- `installer/*.iss` ✅ tracked  
- `installer/*.ps1` ✅ tracked

---

## Verdict: FULL PASS

- ✅ Agent-Coding removed from integration-system
- ✅ All generated folders cleaned
- ✅ Tests: 464 passed (no regressions)
- ✅ .gitignore prevents recurrence
- ✅ Archive preserved at `E:\Project\Master\_archive\integration-system-nested-Agent-Coding-20260609-193828`
