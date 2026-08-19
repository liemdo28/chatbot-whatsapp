require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { runScrape } = require('./src/scraper');
const testAccount = require('./src/accounts')[0];

console.log('Testing login for', testAccount.id);
runScrape(testAccount, true).then(result => {
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));
}).catch(err => {
  console.error('Fatal:', err.message);
});
