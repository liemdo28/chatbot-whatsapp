// Capture "screenshot" evidence — calls each endpoint and saves raw HTTP response
// as a text file (acts as a screenshot of what the live API returns).

const fs = require('fs');
const path = require('path');
const http = require('http');

const EVIDENCE_DIR = path.join(__dirname, '..', 'audit-evidence', 'screenshots');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const PORT = 8788;

function httpGet(p) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: 'localhost', port: PORT, path: p, method: 'GET', timeout: 8000 }, (res) => {
            let chunks = '';
            res.on('data', (d) => (chunks += d));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: chunks }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
    });
}

function httpPost(p, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({
            hostname: 'localhost', port: PORT, path: p, method: 'POST', timeout: 8000,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        }, (res) => {
            let chunks = '';
            res.on('data', (d) => (chunks += d));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: chunks }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(data);
        req.end();
    });
}

function formatScreens(name, method, path, status, body, headers) {
    return [
        '═'.repeat(80),
        `  HTTP "SCREENSHOT" — ${name}`,
        '═'.repeat(80),
        `Request:`,
        `  Method: ${method}`,
        `  URL:    http://localhost:${PORT}${path}`,
        '',
        `Response:`,
        `  Status: ${status}`,
        `  Headers: ${JSON.stringify(headers, null, 2).split('\n').join('\n           ')}`,
        '',
        `Body:`,
        body,
        '',
        '═'.repeat(80),
    ].join('\n');
}

async function main() {
    const captures = [
        { name: '01-health-endpoint', method: 'GET', path: '/health', body: null },
        { name: '02-service-info', method: 'GET', path: '/', body: null },
        { name: '03-audit-log', method: 'GET', path: '/api/reviews/audit-log?limit=5', body: null },
        { name: '04-approvals-queue', method: 'GET', path: '/api/reviews/approvals?limit=5', body: null },
        { name: '05-stores-list', method: 'GET', path: '/api/reviews/stores', body: null },
        {
            name: '06-case-A-positive', method: 'POST', path: '/api/reviews/reply-agent/run',
            body: { store_id: 'bakudan_rim', platform: 'google', rating: 5, review_text: 'Amazing ramen and great service.', reviewer_name: 'Alice' }
        },
        {
            name: '07-case-B-positive-with-detail', method: 'POST', path: '/api/reviews/reply-agent/run',
            body: { store_id: 'bakudan_rim', platform: 'google', rating: 5, review_text: 'The spicy miso ramen was excellent and our server was super friendly.', reviewer_name: 'Bob' }
        },
        {
            name: '08-case-C-mixed', method: 'POST', path: '/api/reviews/reply-agent/run',
            body: { store_id: 'bakudan_rim', platform: 'google', rating: 3, review_text: "Food was good but the ramen came out late and the server didn't check on us.", reviewer_name: 'John' }
        },
        {
            name: '09-case-D-negative', method: 'POST', path: '/api/reviews/reply-agent/run',
            body: { store_id: 'bakudan_rim', platform: 'google', rating: 1, review_text: 'Terrible service and dirty table.', reviewer_name: 'Karen' }
        },
        {
            name: '10-case-E-sensitive', method: 'POST', path: '/api/reviews/reply-agent/run',
            body: { store_id: 'bakudan_rim', platform: 'google', rating: 2, review_text: 'I got sick after eating here.', reviewer_name: 'Anonymous' }
        },
        {
            name: '11-case-F-delivery', method: 'POST', path: '/api/reviews/reply-agent/run',
            body: { store_id: 'bakudan_rim', platform: 'doordash', rating: 2, review_text: 'My DoorDash order was missing items and everything was cold.', reviewer_name: 'Mike' }
        },
        {
            name: '12-analyze-only', method: 'POST', path: '/api/reviews/analyze',
            body: { store_id: 'bakudan_rim', platform: 'google', rating: 4, review_text: 'Pretty good but the parking was bad.', reviewer_name: 'Lisa' }
        },
    ];

    let ok = 0;
    let fail = 0;
    const log = [];
    for (const c of captures) {
        try {
            const resp = c.method === 'GET'
                ? await httpGet(c.path)
                : await httpPost(c.path, c.body);
            const text = formatScreens(c.name, c.method, c.path, resp.status, resp.body, resp.headers);
            fs.writeFileSync(path.join(EVIDENCE_DIR, `${c.name}.txt`), text);
            log.push(`${c.name}: HTTP ${resp.status} ${resp.status === 200 ? '✅' : '❌'}`);
            if (resp.status === 200) ok++; else fail++;
        } catch (err) {
            log.push(`${c.name}: ERROR ${err.message} ❌`);
            fail++;
        }
    }

    const summary = [
        '═══════════════════════════════════════════════════════════════════════════════',
        '  HTTP SCREENSHOTS — LIVE API RESPONSES',
        `  Generated: ${new Date().toISOString()}`,
        `  Service: review-reply-agent on localhost:${PORT}`,
        '═══════════════════════════════════════════════════════════════════════════════',
        '',
        `Total captures: ${captures.length}`,
        `Successful:     ${ok}`,
        `Failed:         ${fail}`,
        '',
        'CAPTURES:',
        ...log.map(l => '  ' + l),
        '',
        'FILES:',
        ...captures.map(c => `  audit-evidence/screenshots/${c.name}.txt`),
        '═══════════════════════════════════════════════════════════════════════════════',
    ].join('\n');

    fs.writeFileSync(path.join(EVIDENCE_DIR, '00-SCREENSHOTS-INDEX.txt'), summary);
    console.log(summary);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error('SCREENSHOTS FAILED:', err.message);
    process.exit(1);
});