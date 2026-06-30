/**
 * DoorDash account registry — 4 brand accounts
 */
module.exports = [
  {
    id: 'bakudan-1',
    brand: 'Bakudan Ramen',
    label: 'B1',
    email: process.env.DD_B1_EMAIL || 'bakudanramen210@gmail.com',
    password: process.env.DD_B1_PASS || 'Rawsushi123',
  },
  {
    id: 'bakudan-2',
    brand: 'Bakudan Ramen',
    label: 'B2',
    email: process.env.DD_B2_EMAIL || 'info@bakudanramen.com',
    password: process.env.DD_B2_PASS || 'B@kudan1',
  },
  {
    id: 'bakudan-3',
    brand: 'Bakudan Ramen',
    label: 'B3',
    email: process.env.DD_B3_EMAIL || 'gm@bakudanramen.com',
    password: process.env.DD_B3_PASS || 'Bakudan1',
  },
  {
    id: 'raw-sushi',
    brand: 'Raw Sushi Bar',
    label: 'Raw',
    email: process.env.DD_RAW_EMAIL || 'h.oang.d.le@gmail.com',
    password: process.env.DD_RAW_PASS || 'rawsushi1',
  },
];
