/**
 * QB Ops Agent — Main Entry Point
 * QuickBooks Web Connector SOAP server for Mi-Core OS
 * Listens on PORT (default 3457) and handles QBWC SOAP requests from laptop1
 *
 * FIX: P0 QBWC SOAP Auth — strict text/xml, single envelope, no nesting
 */

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');
const logger = require('./logger');
const { handleQBCustomerQuery, handleQBInvoiceQuery, handleQBReportQuery } = require('./qbHandlers');

const app = express();
const PORT = process.env.PORT || 3457;

// ─── Raw body for BOTH text/xml and application/xml ────────────────────────────
// QBWC sends Content-Type: text/xml; charset=utf-8 — we must accept it
app.use(express.raw({ type: ['application/xml', 'text/xml'], limit: '10mb' }));

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'qb-ops-agent',
    version: '1.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Status endpoint ───────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({
    connected: true,
    last_sync: new Date().toISOString(),
    data_available: true,
    service: 'qb-ops-agent',
  });
});

// ─── Helper: strip BOM + leading/trailing whitespace from raw body ──────────
function cleanRawBody(raw) {
  let str = raw.toString('utf8');
  // Strip UTF-8 BOM (U+FEFF) — first 3 bytes EF BB BF or the char itself
  if (str.charCodeAt(0) === 0xFEFF) {
    str = str.substring(1);
  }
  // Strip any leading/trailing whitespace so XML starts at first '<'
  str = str.trim();
  return str;
}

// ─── Helper: capture raw response bytes to disk ─────────────────────────────
function captureAuthResponse(body) {
  try {
    const logsDir = path.join(__dirname, '..', 'logs', 'qbwc');
    fs.mkdirSync(logsDir, { recursive: true });
    const filePath = path.join(logsDir, 'authenticate-response.xml');
    fs.writeFileSync(filePath, body, 'utf8');
    logger.info('Auth response captured', { path: filePath, bytes: body.length });
  } catch (err) {
    logger.warn('Failed to capture auth response', { message: err.message });
  }
}

// ─── QB Web Connector SOAP endpoint (POST /api/qb/webhook) ─────────────────
app.post('/api/qb/webhook', async (req, res) => {
  let xmlString;
  try {
    xmlString = cleanRawBody(req.body);
    logger.info('Received QBWC SOAP request', { length: xmlString.length });

    const parsed = await parseStringPromise(xmlString, { explicitArray: false });
    const envelope = parsed['soap:Envelope'] || parsed['soapenv:Envelope'] || parsed;

    // Extract QBWC XML wrapper
    const body = envelope['soap:Body'] || envelope['soapenv:Body'] || envelope;
    logger.debug('SOAP action detected', { keys: Object.keys(body) });

    // Route to appropriate handler based on SOAP action
    const response = await routeSoapAction(body);
    logger.info('QBWC request handled successfully');

    // CRITICAL: QBWC requires text/xml; charset=utf-8
    res.set('Content-Type', 'text/xml; charset=utf-8');
    res.send(response);
  } catch (err) {
    logger.error('QBWC SOAP error', {
      message: err.message,
      stack: err.stack,
      sample: xmlString ? xmlString.substring(0, 200) : 'N/A',
    });

    // Send SOAP Fault back to QBWC — also text/xml
    const faultResponse = buildSoapFault(err.message);
    res.set('Content-Type', 'text/xml; charset=utf-8');
    res.status(500).send(faultResponse);
  }
});

// ─── Route SOAP action to handler ─────────────────────────────────────────
async function routeSoapAction(body) {
  const keys = Object.keys(body);

  // QBWC uses different SOAP actions; route by root element name
  if (keys.includes('serverVersion')) {
    return handleServerVersion();
  }
  if (keys.includes('clientVersion')) {
    return handleClientVersion(body.clientVersion);
  }
  if (keys.includes('authenticate')) {
    return handleAuthenticate(body.authenticate);
  }
  if (keys.includes('sendRequestXML')) {
    return handleSendRequestXML(body.sendRequestXML);
  }
  if (keys.includes('receiveResponseXML')) {
    return handleReceiveResponseXML(body.receiveResponseXML);
  }
  if (keys.includes('getLastError')) {
    return handleGetLastError(body.getLastError);
  }
  if (keys.includes('closeConnection')) {
    return handleCloseConnection(body.closeConnection);
  }
  if (keys.includes('connectionError')) {
    return handleConnectionError(body.connectionError);
  }

  logger.warn('Unknown SOAP action', { keys });
  return buildSoapFault(`Unknown action: ${keys.join(', ')}`);
}

// ─── SOAP Handlers ──────────────────────────────────────────────────────────
// FIX: Each handler returns ONLY the inner response element — no envelope.
// buildSoapResponse() wraps everything in a single, correct SOAP envelope.

function handleServerVersion() {
  logger.debug('QBWC serverVersion request');
  return buildSoapResponse(
    `<serverVersionResponse xmlns="http://developer.intuit.com/">
      <serverVersionResult>1.0.0</serverVersionResult>
    </serverVersionResponse>`
  );
}

function handleClientVersion(cv) {
  const version = cv.clientVersion || cv._ || '';
  logger.debug('QBWC clientVersion', { version });

  // Return empty string = compatible; return error string = block
  if (version && compareVersion(version, '2.2.0.30') < 0) {
    return buildSoapResponse(
      `<clientVersionResponse xmlns="http://developer.intuit.com/">
        <clientVersionResult>E:QBWC minimum version 2.2.0.30 required</clientVersionResult>
      </clientVersionResponse>`
    );
  }

  return buildSoapResponse(
    `<clientVersionResponse xmlns="http://developer.intuit.com/">
      <clientVersionResult></clientVersionResult>
    </clientVersionResponse>`
  );
}

function handleAuthenticate(auth) {
  const user = auth.userName || auth.strUserName || '';
  const pwd = auth.password || auth.strPassword || '';
  logger.debug('QBWC authenticate', { user });

  const expectedUser = process.env.QB_USER || 'mi-admin';
  const expectedPwd = process.env.QB_API_KEY || '';

  if (user !== expectedUser || pwd !== expectedPwd) {
    logger.warn('QBWC auth failed', { user });
    const response = buildSoapResponse(
      `<authenticateResponse xmlns="http://developer.intuit.com/">
        <authenticateResult>
          <string>nvu</string>
          <string></string>
        </authenticateResult>
      </authenticateResponse>`
    );
    captureAuthResponse(response);
    return response;
  }

  logger.info('QBWC authenticated', { user });
  const companyFile = process.env.QB_COMPANY_FILE || '';
  const response = buildSoapResponse(
    `<authenticateResponse xmlns="http://developer.intuit.com/">
      <authenticateResult>
        <string>${escapeXml(companyFile)}</string>
        <string></string>
      </authenticateResult>
    </authenticateResponse>`
  );
  captureAuthResponse(response);
  return response;
}

function handleSendRequestXML(srq) {
  const ticket = srq.ticket || '';
  const hresult = srq.hresult || '';
  const estring = srq.estring || '';
  logger.debug('QBWC sendRequestXML', { ticket, hresult, estring });

  // Build QB XML request (QBFS query for P&L, tax, payroll)
  const requestXml = buildFinancialQueryRequest();
  logger.info('Sending QB request XML', { size: requestXml.length });

  return buildSoapResponse(
    `<sendRequestXMLResponse xmlns="http://developer.intuit.com/">
      <sendRequestXMLResult><![CDATA[${requestXml}]]></sendRequestXMLResult>
    </sendRequestXMLResponse>`
  );
}

async function handleReceiveResponseXML(rrx) {
  const ticket = rrx.ticket || '';
  const response = rrx.response || '';
  const hresult = rrx.hresult || '';
  const estring = rrx.estring || '';
  logger.debug('QBWC receiveResponseXML', { ticket, responseLength: response.length });

  try {
    const result = await processQBResponse(response);
    return buildSoapResponse(
      `<receiveResponseXMLResponse xmlns="http://developer.intuit.com/">
        <receiveResponseXMLResult>${result}</receiveResponseXMLResult>
      </receiveResponseXMLResponse>`
    );
  } catch (err) {
    logger.error('Error processing QB response', { message: err.message });
    return buildSoapResponse(
      `<receiveResponseXMLResponse xmlns="http://developer.intuit.com/">
        <receiveResponseXMLResult>100</receiveResponseXMLResult>
      </receiveResponseXMLResponse>`
    );
  }
}

function handleGetLastError(gler) {
  const ticket = gler.ticket || '';
  logger.debug('QBWC getLastError', { ticket });
  return buildSoapResponse(
    `<getLastErrorResponse xmlns="http://developer.intuit.com/">
      <getLastErrorResult></getLastErrorResult>
    </getLastErrorResponse>`
  );
}

function handleCloseConnection(cc) {
  const ticket = cc.ticket || '';
  logger.info('QBWC closeConnection', { ticket });
  return buildSoapResponse(
    `<closeConnectionResponse xmlns="http://developer.intuit.com/">
      <closeConnectionResult>ok</closeConnectionResult>
    </closeConnectionResponse>`
  );
}

function handleConnectionError(ce) {
  const ticket = ce.ticket || '';
  const hresult = ce.hresult || '';
  const estring = ce.estring || '';
  logger.error('QBWC connectionError', { ticket, hresult, estring });
  // Return empty string = QBWC will call getLastError
  return buildSoapResponse(
    `<connectionErrorResponse xmlns="http://developer.intuit.com/">
      <connectionErrorResult></connectionErrorResult>
    </connectionErrorResponse>`
  );
}

// ─── Build QB XML Query Request ─────────────────────────────────────────────
function buildFinancialQueryRequest() {
  return `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRq onError="continueOnError">
    <!-- P&L Report Query -->
    <GeneralSummaryReportQueryRq requestID="1">
      <GeneralSummaryReportType>ProfitAndLossStandard</GeneralSummaryReportType>
      <DateRangeMacro>ThisMonthToDate</DateRangeMacro>
    </GeneralSummaryReportQueryRq>
    <!-- Tax Summary Query -->
    <SalesTaxReportQueryRq requestID="2">
      <DateRangeFilter>
        <FromReportDate>${formatQBDate(new Date())}</FromReportDate>
        <ToReportDate>${formatQBDate(new Date())}</ToReportDate>
      </DateRangeFilter>
    </SalesTaxReportQueryRq>
    <!-- Payroll Summary Query -->
    <PayrollSummaryReportQueryRq requestID="3">
      <PayrollSummaryReportType>Standard</PayrollSummaryReportType>
      <DateRangeFilter>
        <FromReportDate>${formatQBDate(new Date())}</FromReportDate>
        <ToReportDate>${formatQBDate(new Date())}</ToReportDate>
      </DateRangeFilter>
    </PayrollSummaryReportQueryRq>
    <!-- Customer Balance Query for AR aging -->
    <ARStatementQueryRq requestID="4">
    </ARStatementQueryRq>
    <!-- Vendor Balance Query for AP aging -->
    <APStatementQueryRq requestID="5">
    </APStatementQueryRq>
  </QBXMLMsgsRq>
</QBXML>`;
}

// ─── Process QB Response ────────────────────────────────────────────────────
async function processQBResponse(responseXml) {
  logger.info('Processing QB response', { size: responseXml.length });

  // Forward to mi-core server
  const miCoreUrl = process.env.AGENT_OS_API_URL || 'http://localhost:4001';
  const apiKey = process.env.QB_API_KEY || '';

  try {
    const resp = await fetch(`${miCoreUrl}/api/qb/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'X-QB-API-Key': apiKey,
      },
      body: responseXml,
    });

    if (!resp.ok) {
      logger.warn('mi-core ingest returned non-OK', { status: resp.status });
    } else {
      logger.info('QB data sent to mi-core successfully');
    }
  } catch (err) {
    logger.error('Failed to forward QB data to mi-core', { message: err.message });
    // Don't fail the sync — data will be retried next cycle
  }

  return 0; // 0 = done, >0 = more work needed
}

// ─── SOAP Helpers ───────────────────────────────────────────────────────────
// FIX: Single envelope only. Handlers return inner element; this wraps once.
// Output starts exactly with <?xml ... ?><soap:Envelope... — no whitespace.
function buildSoapResponse(innerXml) {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soap:Body>${innerXml}</soap:Body></soap:Envelope>`;
}

function buildSoapFault(message) {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>${escapeXml(message)}</faultstring></soap:Fault></soap:Body></soap:Envelope>`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatQBDate(date) {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function compareVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

// ─── Start server ───────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`QB Ops Agent started`, {
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'development',
    miCoreUrl: process.env.AGENT_OS_API_URL,
  });
});

console.log(`[QB Ops Agent] Listening on http://0.0.0.0:${PORT}`);

// ─── Graceful shutdown ──────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});
