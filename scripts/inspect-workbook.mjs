import { read, utils } from 'xlsx';

const file = 'C:/Users/shane.odonoghue/Documents/riskpoint-real-data/20260709_DK_RenewalsScreening_004.xlsx';
const workbook = read(file);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = utils.sheet_to_json(sheet, { defval: '' });
console.log('rowCount', rows.length);
console.log('firstRowKeys', Object.keys(rows[0] || {}));
console.log('firstRow', rows[0]);
