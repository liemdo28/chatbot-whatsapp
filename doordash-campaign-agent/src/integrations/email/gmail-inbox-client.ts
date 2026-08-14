import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';

const IMAP_CONNECTION_TIMEOUT_MS = 15_000;
const IMAP_GREETING_TIMEOUT_MS = 10_000;
const IMAP_SOCKET_TIMEOUT_MS = 30_000;
const IMAP_MAX_LITERAL_BYTES = 25 * 1024 * 1024;
const IMAP_MAX_RESPONSE_BYTES = 30 * 1024 * 1024;

export interface GmailInboxAttachment {
    filename: string;
    contentType: string;
    content: Buffer;
}

export interface GmailInboxMessage {
    uid: number;
    messageId: string;
    subject: string;
    from: string[];
    to: string[];
    receivedAt: string;
    text: string;
    attachments: GmailInboxAttachment[];
}

export class ImapAuthenticationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ImapAuthenticationError';
    }
}

export class ImapConnectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ImapConnectionError';
    }
}

function parseAddresses(
    addressField: ParsedMail['from'] | ParsedMail['to'] | ParsedMail['cc'] | ParsedMail['bcc'],
): string[] {
    if (!addressField) return [];
    const entries = Array.isArray(addressField) ? addressField : [addressField];
    return entries
        .flatMap(entry => entry.value || [])
        .map(entry => entry.address || '')
        .filter(Boolean);
}

function inboxConfig() {
    const host = process.env['IMAP_HOST'] || 'imap.gmail.com';
    const port = parseInt(process.env['IMAP_PORT'] || '993', 10);
    const secure = (process.env['IMAP_SECURE'] || 'true').toLowerCase() !== 'false';
    const user = process.env['IMAP_USER'] || process.env['SMTP_USER'] || '';
    const pass = process.env['IMAP_PASS'] || process.env['SMTP_PASS'] || '';

    if (!user || !pass) {
        throw new Error('IMAP is not configured. Set IMAP_USER/IMAP_PASS or reuse SMTP_USER/SMTP_PASS.');
    }

    return { host, port, secure, user, pass };
}

function classifyImapError(error: unknown): Error {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code || '').toUpperCase() : '';
    const message = error instanceof Error ? error.message.toLowerCase() : '';

    if (
        ['AUTHENTICATIONFAILED', 'EAUTH', 'LOGINFAILED'].includes(code)
        || /application-specific password|authentication|auth failed|login failed|invalid credentials|invalid password|username and password/.test(message)
    ) {
        return new ImapAuthenticationError('IMAP authentication failed. Verify IMAP_USER and the Gmail App Password in IMAP_PASS.');
    }

    if (['CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND'].includes(code)) {
        return new ImapConnectionError(`IMAP mailbox connection failed (${code}).`);
    }

    return new ImapConnectionError('IMAP mailbox connection failed.');
}

export class GmailInboxClient {
    async fetchRecentMessages(hoursBack: number = 24, mailbox: string = 'INBOX'): Promise<GmailInboxMessage[]> {
        const config = inboxConfig();
        const client = new ImapFlow({
            host: config.host,
            port: config.port,
            secure: config.secure,
            disableCompression: true,
            auth: {
                user: config.user,
                pass: config.pass,
            },
            connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
            greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
            socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
            maxLiteralSize: IMAP_MAX_LITERAL_BYTES,
            maxResponseSize: IMAP_MAX_RESPONSE_BYTES,
            logger: false,
        });

        let lock: { release(): void } | null = null;
        try {
            await client.connect();
            lock = await client.getMailboxLock(mailbox);
            const since = new Date(Date.now() - (hoursBack * 60 * 60 * 1000));
            const uids = await client.search({ since });
            if (!Array.isArray(uids) || uids.length === 0) {
                return [];
            }
            const messages: GmailInboxMessage[] = [];
            for await (const message of client.fetch(uids, { uid: true, source: true, envelope: true, internalDate: true })) {
                if (!message.source) continue;
                const parsed = await (simpleParser(message.source as Buffer) as Promise<ParsedMail>);
                const receivedAt = message.internalDate instanceof Date
                    ? message.internalDate
                    : parsed.date instanceof Date
                        ? parsed.date
                        : new Date();
                messages.push({
                    uid: Number(message.uid),
                    messageId: parsed.messageId || message.envelope?.messageId || `uid-${message.uid}`,
                    subject: parsed.subject || message.envelope?.subject || '',
                    from: parseAddresses(parsed.from),
                    to: parseAddresses(parsed.to),
                    receivedAt: receivedAt.toISOString(),
                    text: parsed.text || '',
                    attachments: (parsed.attachments || []).map((attachment: { filename?: string; contentType?: string; content: Buffer }) => ({
                        filename: attachment.filename || 'attachment.bin',
                        contentType: attachment.contentType || 'application/octet-stream',
                        content: attachment.content,
                    })),
                });
            }
            messages.sort((left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime());
            return messages;
        } catch (error) {
            throw classifyImapError(error);
        } finally {
            lock?.release();
            await client.logout().catch(() => undefined);
        }
    }
}
