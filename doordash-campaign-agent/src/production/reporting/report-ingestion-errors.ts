export class ReportIngestionError extends Error {
    readonly retryable: boolean;

    constructor(message: string, retryable: boolean) {
        super(message);
        this.name = new.target.name;
        this.retryable = retryable;
    }
}

export class ReportNotReadyError extends ReportIngestionError {
    constructor(message: string) {
        super(message, true);
    }
}

export class ReportDeliveryWindowExpiredError extends ReportIngestionError {
    constructor(message: string) {
        super(message, false);
    }
}

export class ReportAuthenticationError extends ReportIngestionError {
    constructor(message: string) {
        super(message, false);
    }
}

export class ReportStoreMismatchError extends ReportIngestionError {
    constructor(message: string) {
        super(message, false);
    }
}

export class UnsupportedReportArtifactError extends ReportIngestionError {
    constructor(message: string) {
        super(message, false);
    }
}

export function isRetryableReportIngestionError(error: unknown): boolean {
    return error instanceof ReportIngestionError && error.retryable;
}
