# Toast Profile Login Validation

Date: 2026-06-10

## Rules

- Do not store Toast password.
- Do not bypass MFA.
- If login/MFA/CAPTCHA appears, return `HUMAN_REQUIRED`.

## Source Controls Added

The UI panel and Browser-Use wrapper are configured to prefer an existing real browser profile:

```json
{
  "browser_profile": {
    "use_real_profile": true,
    "browser": "chrome",
    "profile_path": "",
    "require_existing_login": true
  }
}
```

Safety task text explicitly instructs:

```text
Do not store passwords and do not bypass MFA or CAPTCHA.
If login, 2FA, CAPTCHA, permission error, or unclear UI appears, stop and return HUMAN_REQUIRED.
```

## Live Validation Result

```text
NOT RUN
```

Reason:

This environment does not have the real laptop Chrome/Edge profile or ToastTab authenticated session.

## Current Verdict

```text
PASS WITH WARNINGS
```

The source handles login blockers safely, but live profile reachability is not proven.
