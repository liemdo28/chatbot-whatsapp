const ACCOUNT_DEFINITIONS = [
  { id: 'bakudan-1', brand: 'Bakudan Ramen', label: 'B1', emailVar: 'DD_B1_EMAIL', passVar: 'DD_B1_PASS' },
  { id: 'bakudan-2', brand: 'Bakudan Ramen', label: 'B2', emailVar: 'DD_B2_EMAIL', passVar: 'DD_B2_PASS' },
  { id: 'bakudan-3', brand: 'Bakudan Ramen', label: 'B3', emailVar: 'DD_B3_EMAIL', passVar: 'DD_B3_PASS' },
  { id: 'raw-sushi', brand: 'Raw Sushi Bar', label: 'Raw', emailVar: 'DD_RAW_EMAIL', passVar: 'DD_RAW_PASS' },
];

function readRequiredEnv(name) {
  return (process.env[name] || '').trim();
}

const missing = [];

const accounts = ACCOUNT_DEFINITIONS.map((definition) => {
  const email = readRequiredEnv(definition.emailVar);
  const password = readRequiredEnv(definition.passVar);

  if (!email) missing.push(definition.emailVar);
  if (!password) missing.push(definition.passVar);

  return {
    id: definition.id,
    brand: definition.brand,
    label: definition.label,
    email,
    password,
  };
});

if (missing.length > 0) {
  throw new Error(
    `Missing required DoorDash account configuration: ${missing.join(', ')}. ` +
    'Populate doordash-agent/.env or set the variables in the process environment.'
  );
}

module.exports = accounts;
