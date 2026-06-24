/**
 * QB XML Handlers
 * Utility functions for building QBXML queries and parsing responses
 * Supports: P&L, Tax Summary, Payroll, AR/AP Aging
 */

const logger = require('./logger');

/**
 * Parse a QB response XML string and extract key financial data points
 */
async function parseQBResponse(xmlString) {
    const { parseStringPromise } = require('xml2js');

    try {
        const parsed = await parseStringPromise(xmlString, { explicitArray: false });
        const data = {
            timestamp: new Date().toISOString(),
            reports: [],
        };

        // Navigate to QBXML response body
        const qbxml = parsed.QBXML;
        if (!qbxml) {
            logger.warn('parseQBResponse: No QBXML root element found');
            return data;
        }

        const msgsRs = qbxml.QBXMLMsgsRs || qbxml;
        if (!Array.isArray(msgsRs)) {
            logger.warn('parseQBResponse: No QBXMLMsgsRs found', { keys: Object.keys(qbxml) });
            return data;
        }

        for (const msg of msgsRs) {
            const reqId = msg.requestID || msg.$?.requestID || 'unknown';
            const statusCode = msg.statusCode || '0';
            const statusSeverity = msg.statusSeverity || 'Info';
            const statusMessage = msg.statusMessage || '';

            if (statusCode !== '0' && statusCode !== '') {
                logger.warn(`QB Response requestID=${reqId} error`, {
                    statusCode,
                    statusSeverity,
                    statusMessage,
                });
            }

            // Extract based on report type
            if (msg.GeneralSummaryReportRs) {
                data.reports.push({
                    type: 'ProfitAndLoss',
                    requestId: reqId,
                    status: statusCode,
                    data: extractReportData(msg.GeneralSummaryReportRs),
                });
            } else if (msg.SalesTaxReportRs) {
                data.reports.push({
                    type: 'SalesTax',
                    requestId: reqId,
                    status: statusCode,
                    data: extractReportData(msg.SalesTaxReportRs),
                });
            } else if (msg.PayrollSummaryReportRs) {
                data.reports.push({
                    type: 'PayrollSummary',
                    requestId: reqId,
                    status: statusCode,
                    data: extractReportData(msg.PayrollSummaryReportRs),
                });
            } else if (msg.ARStatementRs) {
                data.reports.push({
                    type: 'ARStatement',
                    requestId: reqId,
                    status: statusCode,
                    data: extractReportData(msg.ARStatementRs),
                });
            } else if (msg.APStatementRs) {
                data.reports.push({
                    type: 'APStatement',
                    requestId: reqId,
                    status: statusCode,
                    data: extractReportData(msg.APStatementRs),
                });
            } else {
                logger.debug('parseQBResponse: unhandled response type', {
                    requestId: reqId,
                    keys: Object.keys(msg),
                });
            }
        }

        return data;
    } catch (err) {
        logger.error('parseQBResponse failed', { message: err.message });
        return { timestamp: new Date().toISOString(), reports: [], error: err.message };
    }
}

function extractReportData(rs) {
    // ReportDataContainer contains the actual rows
    const container = rs.ReportData ? rs.ReportData : {};
    const rows = [];

    if (container.ReportDataRow) {
        const rawRows = Array.isArray(container.ReportDataRow)
            ? container.ReportDataRow
            : [container.ReportDataRow];

        for (const row of rawRows) {
            const cells = [];
            if (row.ColData) {
                const rawCells = Array.isArray(row.ColData) ? row.ColData : [row.ColData];
                for (const cell of rawCells) {
                    cells.push({
                        value: cell._ || cell.value || cell.$?.value || '',
                        id: cell.$?.id || '',
                    });
                }
            }
            rows.push({ type: row.rowType, cells });
        }
    }

    return { rows };
}

/**
 * Handle QB Customer Query — fetch customer list with balances
 */
async function handleQBCustomerQuery(limit = 100) {
    logger.debug('handleQBCustomerQuery', { limit });

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRq onError="continueOnError">
    <CustomerQueryRq requestID="cust_1">
      <MaxReturned>${limit}</MaxReturned>
      <ActiveStatus>All</ActiveStatus>
      <FromModifiedDate>1970-01-01T00:00:00</FromModifiedDate>
    </CustomerQueryRq>
  </QBXMLMsgsRq>
</QBXML>`;

    return xml;
}

/**
 * Handle QB Invoice Query — fetch unpaid/invoices
 */
async function handleQBInvoiceQuery(options = {}) {
    const { status = 'All', limit = 500 } = options;
    logger.debug('handleQBInvoiceQuery', options);

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRq onError="continueOnError">
    <InvoiceQueryRq requestID="inv_1">
      <MaxReturned>${limit}</MaxReturned>
      <ActiveStatus>${status}</ActiveStatus>
    </InvoiceQueryRq>
  </QBXMLMsgsRq>
</QBXML>`;

    return xml;
}

/**
 * Handle QB Financial Report Query — P&L, Balance Sheet, etc.
 */
async function handleQBReportQuery(reportType = 'ProfitAndLossStandard', dateRange = 'ThisMonthToDate') {
    logger.debug('handleQBReportQuery', { reportType, dateRange });

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRq onError="continueOnError">
    <GeneralSummaryReportQueryRq requestID="rpt_1">
      <GeneralSummaryReportType>${reportType}</GeneralSummaryReportType>
      <DateRangeMacro>${dateRange}</DateRangeMacro>
    </GeneralSummaryReportQueryRq>
  </QBXMLMsgsRq>
</QBXML>`;

    return xml;
}

module.exports = {
    parseQBResponse,
    handleQBCustomerQuery,
    handleQBInvoiceQuery,
    handleQBReportQuery,
};
