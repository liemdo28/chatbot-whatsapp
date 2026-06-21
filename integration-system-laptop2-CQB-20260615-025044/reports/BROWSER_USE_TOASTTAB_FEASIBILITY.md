# Browser-Use ToastTab Feasibility Audit

Date: 2026-06-10

## Scope

Evaluate Browser-Use as an optional AI-assisted ToastTab report download layer without replacing the existing deterministic Playwright downloader.

Required modes:

- `PLAYWRIGHT_STATIC`
- `BROWSER_USE_AGENT`
- `HYBRID_FALLBACK`

Default mode selected:

```text
HYBRID_FALLBACK
```

## Source Verification

Official PyPI package checked:

- `browser-use` latest: `0.13.1`
- Release date: 2026-06-10
- Requires Python: `>=3.11,<4.0`
- Provides extra: `core`

Official GitHub `pyproject.toml` checked:

- `requires-python = ">=3.11,<4.0"`
- `browser-use-core==0.13.1` has Windows x86_64 marker support

Official docs checked:

- Quickstart recommends creating a Python 3.12 environment before install.
- Docs require API key/model setup for Browser-Use execution.
- Docs mention real browser profiles for authentication reuse.
- Docs state CAPTCHA handling is a production/stealth concern and recommend hosted browser infrastructure for that class of issue.

Sources:

- https://pypi.org/project/browser-use/
- https://github.com/browser-use/browser-use/blob/main/pyproject.toml
- https://docs.browser-use.com/open-source/quickstart

## Local Install Feasibility

Local repo venv:

```text
Python 3.13.12
pip 25.3
```

Command:

```powershell
python -m pip index versions browser-use
python -m pip install --dry-run "browser-use[core]==0.13.1"
```

Result:

```text
browser-use 0.13.1 resolved
browser-use-core 0.13.1 win_amd64 resolved
dry-run install succeeded on Python 3.13.12
```

Important production warning:

```text
Current laptop screenshot showed Python 3.14.5.
Browser-Use metadata allows <4.0, but the docs still recommend Python 3.12 and the dry-run was only proven on Python 3.13.12.
Production runtime should be pinned to Python 3.12 or 3.13 before enabling Browser-Use on laptops.
```

## Feasibility Checklist

| Check | Result | Notes |
|---|---|---|
| Can install browser-use in current Python environment? | WARNING | Dry-run succeeds on local Python 3.13.12. Not installed into default app venv. |
| Compatible with Python version? | WARNING | Package metadata allows `>=3.11,<4.0`; docs recommend Python 3.12; laptop Python 3.14.5 remains unproven. |
| Compatible with packaged EXE/PyInstaller? | WARNING | Browser-Use has many dynamic/native dependencies and a Rust core extra. Keep optional/out-of-process until frozen EXE validation passes. |
| Can reuse existing Chrome/Edge profile? | WARNING | Browser-Use supports profile concepts, but real Toast profile reuse must be manually validated on laptop. |
| Can download files to controlled folder? | PASS | Config and wrapper use controlled `download_dir`; implementation validates resulting file. |
| Can run headless/headful? | PASS WITH WARNING | Config supports headless flag; default is `false` for login visibility and safety. |
| Can run safely in background agent? | WARNING | Should not run true Browser-Use in hidden unattended mode if login/MFA/CAPTCHA can appear. Current layer returns `HUMAN_REQUIRED`. |
| Can be disabled by config? | PASS | `toast_download.browser_use.enabled=false` is tested. |

## Decision

Browser-Use is feasible as an optional fallback layer, not as the primary production downloader yet.

Implementation policy:

- Keep Playwright as first attempt.
- Use Browser-Use only on selector/navigation failure.
- Never store passwords.
- Never bypass MFA/CAPTCHA.
- Return `HUMAN_REQUIRED` for login, MFA, CAPTCHA, permission, or unclear UI.
- Do not install Browser-Use by default in one-click laptop setup until Python runtime is pinned and laptop validation passes.

## Verdict

```text
PASS WITH WARNINGS
```

Blocking warnings before production enablement:

- Python 3.14.5 laptop runtime not validated.
- Browser-Use not actually installed on the target laptop.
- Existing Toast Chrome profile login not validated.
- No real Toast report downloaded by Browser-Use yet.
- PyInstaller/frozen EXE compatibility not validated.
