import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';

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

export class GmailInboxClient {
    async fetchRecentMessages(hoursBack: number = 24, mailbox: string = 'INBOX'): Promise<GmailInboxMessage[]> {
        const config = inboxConfig();
        const client = new ImapFlow({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: {
                user: config.user,
                pass: config.pass,
            },
            logger: false,
        });

        await client.connect();
        const lock = await client.getMailboxLock(mailbox);
        try {
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
        } finally {
            lock.release();
            await client.logout().catch(() => undefined);
        }
    }
}
