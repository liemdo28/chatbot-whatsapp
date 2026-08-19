import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

const MAX_ZIP_ENTRY_COUNT = 24;
const MAX_ZIP_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;

export interface ParsedMarketingCampaign {
    campaignId: string;
    campaignName: string;
    campaignType: string;
    storeId: string;
    storeName: string;
    startDate: string;
    endDate: string;
    orders: number;
    sales: number;
    spend: number;
    roas: number;
    observedDateStart: string;
    observedDateEnd: string;
    rowCount: number;
}

export interface ParsedMarketingReport {
    reportPath: string;
    sourceType: 'zip' | 'csv' | 'xlsx';
    extractedFiles: string[];
    reportTypes: string[];
    attachmentHash: string;
    observedDateStart: string | null;
    observedDateEnd: string | null;
    campaigns: ParsedMarketingCampaign[];
}

type CsvRow = Record<string, string>;

function toNumber(value: string | undefined): number {
    if (!value) return 0;
    const parsed = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
}

function safeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 180);
}

function normalizeCampaignType(fileName: string, row: CsvRow): string {
    return row['Type of promotion']
        || (fileName.toUpperCase().includes('SPONSORED_LISTING') ? 'Sponsored Listing' : 'Promotion');
}

function rowSpend(fileName: string, row: CsvRow): number {
    const marketingFees = toNumber(row['Marketing fees | (including any applicable taxes)']);
    const fundedByYou = fileName.toUpperCase().includes('PROMOTION')
        ? toNumber(row['Customer discounts from marketing | (Funded by you)'])
        : 0;
    const credit = toNumber(row['DoorDash marketing credit']);
    const thirdParty = toNumber(row['Third-party contribution']);
    return Math.max(0, marketingFees + fundedByYou - credit - thirdParty);
}

function parseCsvRows(content: string): CsvRow[] {
    return parse(content, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
    }) as CsvRow[];
}

function parseWorkbookRows(buffer: Buffer): Array<{ name: string; rows: CsvRow[] }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return workbook.SheetNames.map((sheetName) => ({
        name: sheetName,
        rows: XLSX.utils.sheet_to_json<CsvRow>(workbook.Sheets[sheetName], { raw: false, defval: '' }),
    }));
}

function fileTypeForPath(filePath: string): 'zip' | 'csv' | 'xlsx' {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.zip') return 'zip';
    if (ext === '.xlsx' || ext === '.xls') return 'xlsx';
    if (ext === '.csv') return 'csv';
    throw new Error(`Unsupported marketing report extension "${ext}" for ${path.basename(filePath)}.`);
}

function validateZipEntryName(entryName: string): void {
    const normalized = entryName.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
        throw new Error(`Unsafe ZIP entry path "${safeFileName(entryName)}".`);
    }
}

function validateZipEntries(entries: AdmZip.IZipEntry[]): void {
    const fileEntries = entries.filter(entry => !entry.isDirectory);
    if (fileEntries.length > MAX_ZIP_ENTRY_COUNT) {
        throw new Error(`ZIP report contains too many files (${fileEntries.length}).`);
    }

    let totalBytes = 0;
    for (const entry of fileEntries) {
        validateZipEntryName(entry.entryName);
        totalBytes += Number(entry.header?.size || 0);
        if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
            throw new Error(`ZIP report exceeds the ${MAX_ZIP_UNCOMPRESSED_BYTES} byte decompression safety limit.`);
        }
    }
}

function mergeRows(
    aggregate: Map<string, ParsedMarketingCampaign>,
    logicalName: string,
    rows: CsvRow[],
): void {
    for (const row of rows) {
        const campaignId = row['Campaign ID'] || '';
        const campaignName = row['Campaign name'] || '';
        const storeId = row['Store ID'] || '';
        const date = row['Date'] || '';
        if (!campaignId || !campaignName || !storeId) continue;
        if (!date) continue;

        const key = `${campaignId}::${campaignName}`;
        const existing = aggregate.get(key) || {
            campaignId,
            campaignName,
            campaignType: normalizeCampaignType(logicalName, row),
            storeId,
            storeName: row['Store name'] || '',
            startDate: row['Campaign start date'] || '',
            endDate: row['Campaign end date'] || '',
            orders: 0,
            sales: 0,
            spend: 0,
            roas: 0,
            observedDateStart: date,
            observedDateEnd: date,
            rowCount: 0,
        };

        existing.orders += toNumber(row['Orders']);
        existing.sales += toNumber(row['Sales']);
        existing.spend += rowSpend(logicalName, row);
        existing.rowCount += 1;
        existing.observedDateStart = existing.observedDateStart < date ? existing.observedDateStart : date;
        existing.observedDateEnd = existing.observedDateEnd > date ? existing.observedDateEnd : date;

        if ((!existing.endDate || existing.endDate === 'None') && row['Campaign end date']) {
            existing.endDate = row['Campaign end date'];
        }
        aggregate.set(key, existing);
    }
}

function buildParsedReport(
    reportPath: string,
    sourceType: 'zip' | 'csv' | 'xlsx',
    extractedFiles: string[],
    reportTypes: Set<string>,
    aggregate: Map<string, ParsedMarketingCampaign>,
): ParsedMarketingReport {
    const campaigns = [...aggregate.values()]
        .map(campaign => ({
            ...campaign,
            roas: campaign.spend > 0 ? Math.round((campaign.sales / campaign.spend) * 100) / 100 : 0,
        }))
        .sort((left, right) => right.spend - left.spend);

    const observedDateStart = campaigns.reduce<string | null>((earliest, campaign) => {
        if (!earliest || campaign.observedDateStart < earliest) return campaign.observedDateStart;
        return earliest;
    }, null);
    const observedDateEnd = campaigns.reduce<string | null>((latest, campaign) => {
        if (!latest || campaign.observedDateEnd > latest) return campaign.observedDateEnd;
        return latest;
    }, null);

    return {
        reportPath,
        sourceType,
        extractedFiles: extractedFiles.map(safeFileName),
        reportTypes: [...reportTypes].sort(),
        attachmentHash: crypto.createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex'),
        observedDateStart,
        observedDateEnd,
        campaigns,
    };
}

export function parseMarketingReportFile(reportPath: string): ParsedMarketingReport {
    const sourceType = fileTypeForPath(reportPath);
    const aggregate = new Map<string, ParsedMarketingCampaign>();
    const extractedFiles: string[] = [];
    const reportTypes = new Set<string>();

    if (sourceType === 'zip') {
        const zip = new AdmZip(fs.readFileSync(reportPath));
        const entries = zip.getEntries();
        validateZipEntries(entries);
        for (const entry of entries) {
            if (entry.isDirectory) continue;
            const lower = entry.entryName.toLowerCase();
            if (lower.endsWith('.csv')) {
                extractedFiles.push(entry.entryName);
                reportTypes.add(lower.includes('sponsored') ? 'sponsored_listing' : 'promotion');
                mergeRows(aggregate, entry.entryName, parseCsvRows(entry.getData().toString('utf8')));
            } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
                extractedFiles.push(entry.entryName);
                for (const sheet of parseWorkbookRows(entry.getData())) {
                    reportTypes.add(sheet.name.toLowerCase().includes('sponsored') ? 'sponsored_listing' : 'promotion');
                    mergeRows(aggregate, `${entry.entryName}:${sheet.name}`, sheet.rows);
                }
            }
        }
        return buildParsedReport(reportPath, sourceType, extractedFiles, reportTypes, aggregate);
    }

    if (sourceType === 'csv') {
        extractedFiles.push(path.basename(reportPath));
        reportTypes.add(path.basename(reportPath).toLowerCase().includes('sponsored') ? 'sponsored_listing' : 'promotion');
        mergeRows(aggregate, path.basename(reportPath), parseCsvRows(fs.readFileSync(reportPath, 'utf8')));
        return buildParsedReport(reportPath, sourceType, extractedFiles, reportTypes, aggregate);
    }

    extractedFiles.push(path.basename(reportPath));
    for (const sheet of parseWorkbookRows(fs.readFileSync(reportPath))) {
        reportTypes.add(sheet.name.toLowerCase().includes('sponsored') ? 'sponsored_listing' : 'promotion');
        mergeRows(aggregate, sheet.name, sheet.rows);
    }
    return buildParsedReport(reportPath, sourceType, extractedFiles, reportTypes, aggregate);
}

export function parseMarketingReportZip(reportPath: string): ParsedMarketingReport {
    return parseMarketingReportFile(reportPath);
}
