const { read, utils } = require('xlsx');
const path = 'C:/Users/shane.odonoghue/Documents/riskpoint-real-data/20260709_DK_RenewalsScreening_004.xlsx';
const wb = read(path, { type: 'file' });
console.log('sheetNames', wb.SheetNames);
for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name];
  console.log('sheet', name, 'range', sheet['!ref']);
  const rows = utils.sheet_to_json(sheet, { defval: '' });
  console.log('rows', rows.length);
  if (rows.length) console.log('firstRow', rows[0]);
}
