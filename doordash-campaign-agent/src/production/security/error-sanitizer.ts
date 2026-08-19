const SECRET_PARAM_NAMES = new Set([
    'access_token',
    'api_key',
    'apikey',
    'auth',
    'authorization',
    'client_secret',
    'key',
    'pass',
    'password',
    'refresh_token',
    'secret',
    'token',
    'user',
    'username',
]);

const SECRET_ENV_NAMES = [
    'DATABASE_URL',
    'DD_REPORT_LINK_AUTHORIZATION',
    'DD_REPORT_LINK_COOKIE',
    'IMAP_PASS',
    'IMAP_USER',
    'OPENAI_API_KEY',
    'SMTP_PASS',
    'SMTP_USER',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeUrl(rawValue: string): string {
    try {
        const url = new URL(rawValue);
        if (url.username) url.username = '<redacted>';
        if (url.password) url.password = '<redacted>';
        for (const key of [...url.searchParams.keys()]) {
            if (SECRET_PARAM_NAMES.has(key.toLowerCase())) {
                url.searchParams.set(key, '<redacted>');
            }
        }
        return url.toString();
    } catch {
        return rawValue;
    }
}

export function sanitizeSecretString(input: string): string {
    let value = String(input || '');
    if (!value) return value;

    value = value.replace(/\b(?:postgres(?:ql)?):\/\/[^\s"'`]+/gi, match => sanitizeUrl(match));
    value = value.replace(/\bhttps?:\/\/[^\s"'`]+/gi, match => sanitizeUrl(match));
    value = value.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '<redacted-openai-key>');
    value = value.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+\b/gi, '$1<redacted>');
    value = value.replace(/(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s,;]+/gi, '$1<redacted>');
    value = value.replace(/(Cookie\s*:\s*)[^\r\n]+/gi, '$1<redacted>');
    value = value.replace(/([?&](?:access_token|api_key|apikey|auth|authorization|client_secret|key|pass|password|refresh_token|secret|token|user|username)=)[^&\s]+/gi, '$1<redacted>');

    for (const envName of SECRET_ENV_NAMES) {
        const envPattern = new RegExp(`(${envName}\\s*[=:]\\s*)([^\\s"'\\\`]+)`, 'gi');
        value = value.replace(envPattern, '$1<redacted>');
    }

    value = value.replace(/((?:imap|smtp|openai|postgres)?(?:_)?(?:user(?:name)?|pass(?:word)?|token|secret)\s*[=:]\s*)([^,\s;]+)/gi, '$1<redacted>');
    return value;
}

export function sanitizeJsonString(value: string | null): string | null {
    if (!value) return value;
    try {
        return JSON.stringify(sanitizeSecrets(JSON.parse(value)));
    } catch {
        return sanitizeSecretString(value);
    }
}

export function sanitizeSecrets<T>(input: T): T {
    if (typeof input === 'string') {
        return sanitizeSecretString(input) as T;
    }
    if (Array.isArray(input)) {
        return input.map(item => sanitizeSecrets(item)) as T;
    }
    if (isPlainObject(input)) {
        const output: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input)) {
            if (SECRET_PARAM_NAMES.has(key.toLowerCase()) || SECRET_ENV_NAMES.includes(key)) {
                output[key] = '<redacted>';
            } else {
                output[key] = sanitizeSecrets(value);
            }
        }
        return output as T;
    }
    return input;
}

export function sanitizeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return sanitizeSecretString(error.message || error.name || 'Unknown error');
    }
    return sanitizeSecretString(String(error));
}
