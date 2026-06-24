/**
 * Test connection script for QB Ops Agent
 * Run with: node src/testConnection.js
 */

require('dotenv').config();

const AGENT_URL = process.env.QB_AGENT_URL || `http://localhost:${process.env.PORT || 3457}`;
const QB_API_KEY = process.env.QB_API_KEY || '';

async function test() {
    console.log(`[test] Testing QB Ops Agent at: ${AGENT_URL}`);
    console.log('');

    // Test 1: Health endpoint
    try {
        const healthRes = await fetch(`${AGENT_URL}/health`);
        const health = await healthRes.json();
        console.log(`[PASS] GET /health — ${healthRes.status}`);
        console.log(`       uptime: ${Math.round(health.uptime)}s, status: ${health.status}`);
    } catch (err) {
        console.log(`[FAIL] GET /health — ${err.message}`);
    }
    console.log('');

    // Test 2: Status endpoint
    try {
        const statusRes = await fetch(`${AGENT_URL}/status`);
        const status = await statusRes.json();
        console.log(`[PASS] GET /status — ${statusRes.status}`);
        console.log(`       connected: ${status.connected}, last_sync: ${status.last_sync}`);
    } catch (err) {
        console.log(`[FAIL] GET /status — ${err.message}`);
    }
    console.log('');

    // Test 3: QB SOAP endpoint (mock authenticate SOAP request)
    const mockSoapAuth = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <authenticate xmlns="http://developer.intuit.com/">
      <strUserName>mi-admin</strUserName>
      <strPassword>${QB_API_KEY || 'test-api-key'}</strPassword>
    </authenticate>
  </soap:Body>
</soap:Envelope>`;

    try {
        const soapRes = await fetch(`${AGENT_URL}/api/qb/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/xml' },
            body: mockSoapAuth,
        });
        const soapBody = await soapRes.text();
        const isAuthSuccess = soapBody.includes('authenticateResult') || soapBody.includes('authenticateResponse');
        console.log(`[${isAuthSuccess ? 'PASS' : 'WARN'}] POST /api/qb/webhook (authenticate) — ${soapRes.status}`);
        console.log(`       Response snippet: ${soapBody.substring(0, 150).replace(/\n/g, ' ')}`);
    } catch (err) {
        console.log(`[FAIL] POST /api/qb/webhook — ${err.message}`);
    }
    console.log('');

    // Summary
    console.log('---');
    console.log('If all tests pass, QB Ops Agent is ready.');
    console.log('Next: Load mi-core-connector.qwc into QB Web Connector on laptop1.');
}

test().catch(console.error);
