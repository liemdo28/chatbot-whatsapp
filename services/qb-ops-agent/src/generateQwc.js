/**
 * Generate mi-core-connector.qwc
 * Run with: node src/generateQwc.js
 *
 * Reads LAPTOP1_IP from .env and writes the .qwc XML file
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const LAPTOP1_IP = process.env.LAPTOP1_IP || '192.168.1.100'; // TODO: replace with actual
const QB_COMPANY_FILE = process.env.QB_COMPANY_FILE || 'C:\\ProgramData\\Intuit\\QuickBooks\\Company Files\\MI_CEO.qbw';

const qwcContent = `<?xml version="1.0"?>
<QBWCXML>
  <AppName>Mi-Core Financial Connector</AppName>
  <AppID>mi-core-qb-001</AppID>
  <AppURL>http://${LAPTOP1_IP}:3456/api/qb/webhook</AppURL>
  <AppDescription>Mi CEO OS - QuickBooks data sync via QB Web Connector</AppDescription>
  <AppSupport>http://${LAPTOP1_IP}:3456</AppSupport>
  <UserName>mi-admin</UserName>
  <OwnerID>{8A2D4F9E-1B3C-4D5E-8F6A-7B2C3D4E5F6A}</OwnerID>
  <FileID>{1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D}</FileID>
  <QBType>QBFS</QBType>
  <Scheduler>
    <RunEveryNMinutes>360</RunEveryNMinutes>
  </Scheduler>
</QBWCXML>
`;

const outputPath = path.join(__dirname, '..', 'mi-core-connector.qwc');

fs.writeFileSync(outputPath, qwcContent, 'utf8');
console.log(`[generateQwc] Written: ${outputPath}`);
console.log(`[generateQwc] LAPTOP1_IP=${LAPTOP1_IP}`);
console.log(`[generateQwc] Copy this file to laptop1 and load into QB Web Connector.`);
