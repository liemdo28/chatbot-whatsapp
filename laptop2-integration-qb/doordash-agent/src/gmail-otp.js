/**
 * Reads DoorDash 2FA OTP from Gmail.
 * Uses Mi-Core Gmail connector via HTTP.
 */
const http = require('http');

const MI_CORE_URL = process.env.MI_CORE_URL || 'http://127.0.0.1:4001';

async function fetchMiCore(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${MI_CORE_URL}${path}`, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Bad JSON')); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * Poll Gmail for a DoorDash 2FA code sent to the given email.
 * Waits up to maxWaitMs (default 60s), polling every 5s.
 */
async function waitForDoorDashOTP(recipientEmail, maxWaitMs = 60000) {
  const start = Date.now();
  console.log(`[gmail-otp] Waiting for DoorDash OTP to ${recipientEmail} (up to ${maxWaitMs/1000}s)...`);

  while (Date.now() - start < maxWaitMs) {
    try {
      // GET /api/gmail/messages?q=from:doordash+subject:verification&limit=3
      const q = encodeURIComponent(`from:doordash subject:verification newer_than:5m to:${recipientEmail}`);
      const data = await fetchMiCore(`/api/gmail/messages?q=${q}&limit=5`);
      const messages = data.messages || data.emails || [];

      for (const msg of messages) {
        const snippet = (msg.snippet || msg.body || msg.text || '').replace(/&#39;/g, "'");
        // Look for 6-digit OTP
        const otpMatch = snippet.match(/\b(\d{6})\b/);
        if (otpMatch) {
          const otp = otpMatch[1];
          const msgTime = msg.date || msg.receivedAt || '';
          // Only accept OTPs from the last 5 minutes
          const msgAge = msgTime ? (Date.now() - new Date(msgTime).getTime()) : 0;
          if (!msgTime || msgAge < 5 * 60 * 1000) {
            console.log(`[gmail-otp] Found OTP: ${otp} (age: ${Math.round(msgAge/1000)}s)`);
            return otp;
          }
        }
      }
    } catch (err) {
      console.log(`[gmail-otp] Gmail poll error: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('[gmail-otp] Timed out waiting for OTP');
  return null;
}

module.exports = { waitForDoorDashOTP };
