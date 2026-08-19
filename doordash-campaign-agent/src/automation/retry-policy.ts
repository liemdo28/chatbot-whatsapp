export interface RetryPolicy {
    attempts: number;
    initialDelayMs: number;
    backoffMultiplier: number;
    maxDelayMs: number;
    shouldRetry?: (error: Error, attempt: number, maxAttempts: number) => boolean;
}

export interface RetryContext {
    attempt: number;
    maxAttempts: number;
    error: Error;
    nextDelayMs: number;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runWithRetry<T>(
    task: () => Promise<T>,
    policy: RetryPolicy,
    onRetry?: (context: RetryContext) => Promise<void> | void,
): Promise<T> {
    let delayMs = Math.max(0, policy.initialDelayMs);
    const attempts = Math.max(1, policy.attempts);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await task();
        } catch (error: any) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            const canRetry = attempt < attempts && (policy.shouldRetry ? policy.shouldRetry(normalized, attempt, attempts) : true);
            if (!canRetry) {
                throw normalized;
            }

            const nextDelayMs = Math.min(
                Math.max(0, delayMs),
                Math.max(0, policy.maxDelayMs),
            );

            if (onRetry) {
                await onRetry({
                    attempt,
                    maxAttempts: attempts,
                    error: normalized,
                    nextDelayMs,
                });
            }

            if (nextDelayMs > 0) {
                await sleep(nextDelayMs);
            }
            delayMs = Math.max(1, Math.round((delayMs || 1) * Math.max(1, policy.backoffMultiplier)));
        }
    }

    throw new Error('Retry policy exhausted without returning or throwing.');
}
