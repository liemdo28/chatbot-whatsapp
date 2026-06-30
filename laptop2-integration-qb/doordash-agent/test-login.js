const { runScrape } = require('./src/scraper');

const testAccount = {
  id: 'bakudan-1',
  brand: 'Bakudan Ramen',
  label: 'B1',
  email: 'bakudanramen210@gmail.com',
  password: 'Rawsushi123',
};

console.log('Testing login for', testAccount.id);
runScrape(testAccount, true).then(result => {
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));
}).catch(err => {
  console.error('Fatal:', err.message);
});
