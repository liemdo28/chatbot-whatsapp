/**
 * QBXML Parser — converts raw QuickBooks XML responses into structured financial data.
 *
 * The QBWC server sends 3 requests per sync cycle:
 *   Request 0: AccountQueryRq (Income + Expense accounts)
 *   Request 1: SalesReceiptQueryRq (last 30 days)
 *   Request 2: InvoiceQueryRq (last 30 days)
 *
 * This parser extracts the relevant financial data and normalizes it
 * into a clean JSON structure for the CEO dashboard.
 */
import xml2js from 'xml2js';
import { logger } from '../storage/logs';

// We use `any` for the parsed XML tree because QBXML structures are deeply
// recursive and vary per query type. The typed interfaces below provide the
// boundary between raw XML and our application model.

// ── Types ────────────────────────────────────────────────────────────────────

export interface QbAccount {
    name: string;
    type: string;
    balance: number;
    account_type: string;   // Income | Expense
    account_number?: string;
}

export interface QbSalesReceipt {
    txn_id: string;
    txn_number?: string;
    txn_date: string;
    customer_name: string;
    total_amount: number;
    items: QbLineItem[];
}

export interface QbInvoice {
    txn_id: string;
    txn_number?: string;
    txn_date: string;
    due_date?: string;
    customer_name: string;
    balance_remaining: number;
    total_amount: number;
    items: QbLineItem[];
}

export interface QbLineItem {
    description: string;
    quantity: number;
    amount: number;
    rate?: number;
}

export interface ParsedFinancialData {
    accounts: QbAccount[];
    sales_receipts: QbSalesReceipt[];
    invoices: QbInvoice[];
    summary: FinancialSummary;
    parsed_at: string;
}

export interface FinancialSummary {
    total_income_accounts: number;
    total_expense_accounts: number;
    total_income_balance: number;
    total_expense_balance: number;
    total_sales_receipts_30d: number;
    total_invoices_30d: number;
    total_invoices_outstanding: number;
    total_revenue_30d: number;
    net_income_30d: number;
    transaction_count: number;
}

// ── Parser ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlObj = Record<string, any>;

const makeParser = () => new xml2js.Parser({
    explicitArray: false,
    tagNameProcessors: [xml2js.processors.stripPrefix],
    attrkey: '$',
});

function parseXmlSync(parserInstance: xml2js.Parser, xml: string): XmlObj | null {
    try {
        let result: XmlObj = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parserInstance.parseString(xml, (err: any, parsed: XmlObj) => {
            if (!err && parsed) result = parsed;
        });
        return Object.keys(result).length > 0 ? result : null;
    } catch {
        return null;
    }
}

/**
 * Parse a single QBXML response string (async version).
 */
export async function parseQbxmlResponse(xml: string): Promise<XmlObj | null> {
    try {
        const parserInstance = makeParser();
        const result = await parserInstance.parseStringPromise(xml);
        return result as XmlObj;
    } catch (err) {
        logger.error('Failed to parse QBXML', { error: err instanceof Error ? err.message : String(err) });
        return null;
    }
}

// ── Account parsing ──────────────────────────────────────────────────────────

function categorizeAccountType(qbType: string): string {
    const t = qbType.toLowerCase();
    if (t.includes('income') || t.includes('revenue')) return 'Income';
    if (t.includes('expense') || t.includes('cost of goods')) return 'Expense';
    return 'Other';
}

function parseAccounts(xml: string): QbAccount[] {
    const accounts: QbAccount[] = [];
    try {
        const parsed = parseXmlSync(makeParser(), xml);
        if (!parsed) return accounts;

        const qbxml = parsed.QBXML ?? parsed;
        const msgs = qbxml.QBXMLMsgsRs ?? qbxml;
        const acctRs = msgs.AccountQueryRs;
        if (!acctRs) return accounts;

        let acctRet = acctRs.AccountRet;
        if (!acctRet) return accounts;
        if (!Array.isArray(acctRet)) acctRet = [acctRet];

        for (const acct of acctRet) {
            accounts.push({
                name: acct.Name || '',
                type: acct.AccountType || acct.AccountSubType || '',
                balance: parseFloat(acct.Balance || '0') || 0,
                account_type: categorizeAccountType(acct.AccountType || ''),
                account_number: acct.AccountNumber || undefined,
            });
        }
    } catch (err) {
        logger.warn('Failed to parse accounts', { error: err instanceof Error ? err.message : String(err) });
    }
    return accounts;
}

// ── Sales receipt parsing ────────────────────────────────────────────────────

function parseLineItems(lineRet: unknown): QbLineItem[] {
    const items: QbLineItem[] = [];
    if (!lineRet) return items;

    let lines: XmlObj[] = [];
    if (Array.isArray(lineRet)) {
        lines = lineRet as XmlObj[];
    } else {
        lines = [lineRet as XmlObj];
    }

    for (const line of lines) {
        const itemRef = line.ItemRef;
        const fullName = (itemRef && typeof itemRef === 'object') ? (itemRef.FullName || '') : '';
        items.push({
            description: line.Description || fullName || '',
            quantity: parseFloat(line.Quantity || '1') || 1,
            amount: parseFloat(line.Amount || '0') || 0,
            rate: line.Rate ? parseFloat(String(line.Rate)) || undefined : undefined,
        });
    }
    return items;
}

function parseSalesReceipts(xml: string): QbSalesReceipt[] {
    const receipts: QbSalesReceipt[] = [];
    try {
        const parsed = parseXmlSync(makeParser(), xml);
        if (!parsed) return receipts;

        const qbxml = parsed.QBXML ?? parsed;
        const msgs = qbxml.QBXMLMsgsRs ?? qbxml;
        const srRs = msgs.SalesReceiptQueryRs;
        if (!srRs) return receipts;

        let srRet = srRs.SalesReceiptRet;
        if (!srRet) return receipts;
        if (!Array.isArray(srRet)) srRet = [srRet];

        for (const sr of srRet) {
            const custRef = sr.CustomerRef;
            const custName = (custRef && typeof custRef === 'object')
                ? (custRef.FullName || custRef.ListID || '')
                : '';
            const items = parseLineItems(sr.SalesReceiptLineRet);
            receipts.push({
                txn_id: sr.TxnID || '',
                txn_number: sr.TxnNumber || undefined,
                txn_date: sr.TxnDate || '',
                customer_name: custName,
                total_amount: parseFloat(sr.TotalAmount || '0') || 0,
                items,
            });
        }
    } catch (err) {
        logger.warn('Failed to parse sales receipts', { error: err instanceof Error ? err.message : String(err) });
    }
    return receipts;
}

// ── Invoice parsing ──────────────────────────────────────────────────────────

function parseInvoices(xml: string): QbInvoice[] {
    const invoices: QbInvoice[] = [];
    try {
        const parsed = parseXmlSync(makeParser(), xml);
        if (!parsed) return invoices;

        const qbxml = parsed.QBXML ?? parsed;
        const msgs = qbxml.QBXMLMsgsRs ?? qbxml;
        const invRs = msgs.InvoiceQueryRs;
        if (!invRs) return invoices;

        let invRet = invRs.InvoiceRet;
        if (!invRet) return invoices;
        if (!Array.isArray(invRet)) invRet = [invRet];

        for (const inv of invRet) {
            const custRef = inv.CustomerRef;
            const custName = (custRef && typeof custRef === 'object')
                ? (custRef.FullName || custRef.ListID || '')
                : '';
            const items = parseLineItems(inv.InvoiceLineRet);
            invoices.push({
                txn_id: inv.TxnID || '',
                txn_number: inv.TxnNumber || undefined,
                txn_date: inv.TxnDate || '',
                due_date: inv.DueDate || undefined,
                customer_name: custName,
                balance_remaining: parseFloat(inv.BalanceRemaining || '0') || 0,
                total_amount: parseFloat(inv.TotalAmount || '0') || 0,
                items,
            });
        }
    } catch (err) {
        logger.warn('Failed to parse invoices', { error: err instanceof Error ? err.message : String(err) });
    }
    return invoices;
}

// ── Summary builder ──────────────────────────────────────────────────────────

function buildSummary(
    accounts: QbAccount[],
    salesReceipts: QbSalesReceipt[],
    invoices: QbInvoice[]
): FinancialSummary {
    const incomeAccounts = accounts.filter(a => a.account_type === 'Income');
    const expenseAccounts = accounts.filter(a => a.account_type === 'Expense');

    const totalSales = salesReceipts.reduce((sum, r) => sum + r.total_amount, 0);
    const totalInvoiceAmount = invoices.reduce((sum, i) => sum + i.total_amount, 0);
    const totalOutstanding = invoices.reduce((sum, i) => sum + i.balance_remaining, 0);
    const totalExpense = expenseAccounts.reduce((sum, a) => sum + a.balance, 0);

    return {
        total_income_accounts: incomeAccounts.length,
        total_expense_accounts: expenseAccounts.length,
        total_income_balance: incomeAccounts.reduce((sum, a) => sum + a.balance, 0),
        total_expense_balance: totalExpense,
        total_sales_receipts_30d: totalSales,
        total_invoices_30d: totalInvoiceAmount,
        total_invoices_outstanding: totalOutstanding,
        total_revenue_30d: totalSales + totalInvoiceAmount,
        net_income_30d: (totalSales + totalInvoiceAmount) - totalExpense,
        transaction_count: salesReceipts.length + invoices.length,
    };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse all raw QB data responses into a single ParsedFinancialData structure.
 *
 * @param rawEntries - Array of { request_index, xml } entries from qb-raw-data.json
 *                    Request 0 = accounts, 1 = sales receipts, 2 = invoices
 */
export function parseAllFinancialData(
    rawEntries: Array<{ request_index: number; xml: string }>
): ParsedFinancialData | null {
    if (!rawEntries.length) return null;

    const accounts: QbAccount[] = [];
    const salesReceipts: QbSalesReceipt[] = [];
    const invoices: QbInvoice[] = [];

    for (const entry of rawEntries) {
        if (entry.request_index === 0) {
            accounts.push(...parseAccounts(entry.xml));
        } else if (entry.request_index === 1) {
            salesReceipts.push(...parseSalesReceipts(entry.xml));
        } else if (entry.request_index === 2) {
            invoices.push(...parseInvoices(entry.xml));
        }
    }

    const summary = buildSummary(accounts, salesReceipts, invoices);

    return {
        accounts,
        sales_receipts: salesReceipts,
        invoices,
        summary,
        parsed_at: new Date().toISOString(),
    };
}
