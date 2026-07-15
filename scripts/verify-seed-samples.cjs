const fs = require('fs');
const path = require('path');
const countries = ['dk', 'no', 'se', 'fi'];
for (const country of countries) {
  const file = path.join(__dirname, '..', 'data', 'seed', `${country}.json`);
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sample = rows[0];
  console.log(`--- ${country.toUpperCase()} ---`);
  console.log(JSON.stringify(sample, null, 2));
  const flagged = rows.filter((row) => row.renewalTypeManual || row.dnbRatingBelowA || row.latestProfitNegative || row.assetsMovedSignificant).slice(0, 2);
  console.log('flagged samples');
  console.log(JSON.stringify(flagged, null, 2));
}
