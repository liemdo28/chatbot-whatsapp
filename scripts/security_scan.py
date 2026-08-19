#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST_PATH = ROOT / "scripts" / "security_scan_allowlist.json"


@dataclass(frozen=True)
class Violation:
    rule: str
    path: str
    line_number: int | None
    detail: str


PLACEHOLDER_MARKERS = (
    "<required",
    "<replace",
    "<change_me",
    "<your_",
    "<your-",
    "replace_with",
    "change_me",
    "your_",
    "your-",
    "example",
    "placeholder",
    "dummy",
    "sample",
    "todo",
    "secret123",
    "secret-token",
    "new-key",
    "fill this in",
    "set-this-to-the-same-value-as",
    "generate-32-char-key",
    "test_",
    "test-",
)

FORBIDDEN_PATH_RULES = (
    (
        "tracked-env-file",
        re.compile(r"(^|/)\.env(\..+)?$", re.IGNORECASE),
        lambda path: path.lower().endswith(".env.example")
        or path.lower().endswith(".env.qb.example")
        or path.lower().endswith(".env.agent.example")
        or path.lower().endswith(".env.example.txt"),
        "Tracked runtime environment files are forbidden; keep only placeholder example templates in Git.",
    ),
    (
        "tracked-env-template",
        re.compile(r"(^|/)env-laptop2\.txt$", re.IGNORECASE),
        lambda path: False,
        "The tracked env-laptop2.txt template is forbidden; use env-laptop2.example.txt placeholders instead.",
    ),
    (
        "tracked-local-config",
        re.compile(
            r"(^|/)(local-config\.json|credentials\.json|token\.json|\.toast-session\.json|accounts(\.[^.]+)?\.local\.json|\.machine_token)$",
            re.IGNORECASE,
        ),
        lambda path: False,
        "Tracked local runtime credential/config files are forbidden.",
    ),
    (
        "tracked-company-files",
        re.compile(r"(^|/)qb-ops-agent/data/company-files\.json$", re.IGNORECASE),
        lambda path: False,
        "Tracked qb-ops-agent company-files.json is forbidden; keep only local ignored copies or example templates.",
    ),
    (
        "tracked-browser-session",
        re.compile(
            r"(^|/)(sessions?|session|cookies?|login data|web data|history|local storage|session storage|indexeddb|auth-state|playwright-data)(/|$)",
            re.IGNORECASE,
        ),
        lambda path: path.lower().endswith("/readme.md"),
        "Tracked browser/session state is forbidden.",
    ),
    (
        "tracked-browser-session-backup",
        re.compile(r"(^|/)laptop2-integration-qb/whatsapp-ai-gateway/data/backup/.+/(session|cookies|login data|web data|history|local storage|session storage|indexeddb)(/|$)", re.IGNORECASE),
        lambda path: False,
        "Tracked WhatsApp backup browser/session artifacts are forbidden.",
    ),
)

LINE_RULES = (
    (
        "private-key",
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
        lambda match: "Private key material detected.",
    ),
    (
        "bearer-token",
        re.compile(r"Authorization\s*[:=]\s*[\"']?Bearer\s+([A-Za-z0-9._-]{16,})", re.IGNORECASE),
        lambda match: "Hardcoded bearer token detected.",
    ),
    (
        "database-url",
        re.compile(r"(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?):\/\/[^\/\s:@]+:[^@\s]+@", re.IGNORECASE),
        lambda match: "Database URL with embedded credentials detected.",
    ),
    (
        "credential-assignment",
        re.compile(r"^(?P<key>[A-Z0-9_]*(?:^|_)(?:TOKEN|SECRET|PASSWORD|API_KEY|PASS)(?:_|$)[A-Z0-9_]*)=(?P<value>.+)$"),
        lambda match: f"Hardcoded value assigned to {match.group('key')}.",
    ),
    (
        "credential-assignment",
        re.compile(r"\"(?P<key>[A-Za-z0-9_-]*(?:password|passwd|token|secret|api[_-]?key)[A-Za-z0-9_-]*)\"\s*:\s*\"(?P<value>[^\"]+)\"", re.IGNORECASE),
        lambda match: f"Hardcoded value assigned to JSON key {match.group('key')}.",
    ),
    (
        "credential-assignment",
        re.compile(
            r"process\.env\.(?P<key>[A-Z0-9_]*(?:^|_)(?:TOKEN|SECRET|PASSWORD|API_KEY|PASS)(?:_|$)[A-Z0-9_]*)\s*\|\|\s*[\"'](?P<value>[^\"']+)[\"']",
            re.IGNORECASE,
        ),
        lambda match: f"Fallback credential literal for {match.group('key')}.",
    ),
)


def git_tracked_files() -> list[str]:
    output = subprocess.check_output(["git", "-C", str(ROOT), "ls-files"], text=True)
    return [line.strip() for line in output.splitlines() if line.strip()]


def load_allowlist() -> list[dict[str, str]]:
    if not ALLOWLIST_PATH.exists():
        return []
    return json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))


def normalize(path: str) -> str:
    return path.replace("\\", "/")


def is_placeholder_value(key: str, value: str) -> bool:
    lowered_key = key.lower()
    lowered = value.strip().strip("'\"").lower()
    if not lowered or lowered in {"null", "undefined", "none"}:
        return True
    if "${" in value:
        return True
    if lowered_key.endswith("_env") or lowered_key == "password_key":
        return True
    if re.fullmatch(r"pass\d+", lowered):
        return True
    if any(marker in lowered for marker in PLACEHOLDER_MARKERS):
        return True
    if lowered.startswith("<") and lowered.endswith(">"):
        return True
    return False


def is_allowlisted(allowlist: list[dict[str, str]], violation: Violation, line: str) -> bool:
    for entry in allowlist:
        rule = entry.get("rule")
        path_regex = entry.get("path_regex")
        line_regex = entry.get("line_regex")
        if rule and rule != violation.rule:
            continue
        if path_regex and not re.search(path_regex, violation.path):
            continue
        if line_regex and not re.search(line_regex, line):
            continue
        return True
    return False


def read_text(path: Path) -> str | None:
    try:
        data = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None
    except OSError:
        return None
    if "\x00" in data:
        return None
    return data


def should_skip_content_scan(path: str) -> bool:
    lowered = path.lower()
    return lowered.endswith("package-lock.json")


def scan() -> list[Violation]:
    allowlist = load_allowlist()
    violations: list[Violation] = []

    for rel_path in git_tracked_files():
        normalized = normalize(rel_path)
        file_path = ROOT / rel_path

        if not file_path.exists():
            continue

        for rule, pattern, exempt, detail in FORBIDDEN_PATH_RULES:
            if pattern.search(normalized) and not exempt(normalized):
                violations.append(Violation(rule, normalized, None, detail))

        if should_skip_content_scan(normalized):
            continue

        text = read_text(file_path)
        if text is None:
            continue

        for index, line in enumerate(text.splitlines(), start=1):
            for rule, pattern, detail_fn in LINE_RULES:
                match = pattern.search(line)
                if not match:
                    continue

                key = match.groupdict().get("key", "")
                value = match.groupdict().get("value", "")
                if value and is_placeholder_value(key, value):
                    continue

                violation = Violation(rule, normalized, index, detail_fn(match))
                if is_allowlisted(allowlist, violation, line):
                    continue
                violations.append(violation)

    return violations


def main() -> int:
    violations = scan()
    if not violations:
        print("Security scan passed: no tracked secret or forbidden-path violations found.")
        return 0

    print("Security scan failed with tracked secret or forbidden-path violations:")
    for violation in violations:
        location = f"{violation.path}:{violation.line_number}" if violation.line_number else violation.path
        print(f"- {location} [{violation.rule}] {violation.detail}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
