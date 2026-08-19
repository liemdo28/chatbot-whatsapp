# Repository Security Scan

This repository now includes a lightweight tracked-file security check:

```bash
python3 scripts/security_scan.py
```

## What it checks

- tracked runtime `.env` files and deprecated `env-laptop2.txt` templates
- tracked browser/session/profile artifacts
- tracked local runtime credential/config files
- tracked `qb-ops-agent/data/company-files.json`
- hardcoded bearer tokens
- hardcoded database URLs with embedded credentials
- obvious secret/password/token/API-key assignments
- private key material

The scanner only prints file paths, line numbers, and rule names. It does not print matched secret values.

## False-positive allowlisting

Add justified exceptions to `scripts/security_scan_allowlist.json`.

Each entry supports:

- `rule`: rule id to scope the exception
- `path_regex`: regex matching the tracked repository path
- `line_regex`: regex matching the safe placeholder/test line
- `reason`: human-readable justification

Keep allowlist entries narrow and explain why the match is a placeholder or a test fixture rather than a real credential.
