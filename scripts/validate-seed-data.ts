import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { read, utils } from 'xlsx';

// Re-runnable validation for the anonymization step (§8): confirms the anonymized seed
// data still matches the real source files' distributions, and greps for any real
// customer/broker/identifier/policy-number that might have leaked through a bug.
// Run this after every re-anonymization — a manual eyeball isn't a reliable enough
// check given what's at stake (real RiskPoint policy data, see §8).

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const realDataDir = 'C:/Users/shane.odonoghue/Documents/riskpoint-real-data';
const seedDir = path.join(rootDir, 'data', 'seed');

const countryFiles = [
  { country: 'DK', file: '20260709_DK_RenewalsScreening_004.xlsx' },
  { country: 'NO', file: '20260709_NO_RenewalsScreening_002.xlsx' },
  { country: 'SE', file: '20260709_SE_RenewalsScreening_002.xlsx' },
  { country: 'FI', file: '20260709_FI_RenewalsScreening_002.xlsx' },
] as const;

type RealRow = {
  policyNumber: string;
  customerName: string;
  customerIdentifier: string;
  brokerName: string;
  routing: string;
  attention: string;
};

function parseRealRows(filePath: string): RealRow[] {
  const workbook = read(filePath, { type: 'file' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const headerRow = rows[0] as Record<string, unknown> | undefined;
  if (!headerRow) return [];

  const colMap = new Map<string, string>();
  for (const [rawKey, rawValue] of Object.entries(headerRow)) {
    colMap.set(String(rawValue).trim(), rawKey);
  }
  const col = (label: string) => colMap.get(label);

  return rows
    .slice(1)
    .map((row) => ({
      policyNumber: String(row[col('Policy No.') ?? ''] ?? '').trim(),
      customerName: String(row[col('Customer Name') ?? ''] ?? '').trim(),
      customerIdentifier: String(row[col('Customer Identifier') ?? ''] ?? '').trim(),
      brokerName: String(row[col('Broker Name') ?? ''] ?? '').trim(),
      routing: String(row[col('Routing') ?? ''] ?? '').trim(),
      attention: String(row[col('Attention') ?? ''] ?? '').trim(),
    }))
    .filter((r) => r.policyNumber || r.customerName);
}

// The real file uses "—" for no-attention rows; the app's seed data normalizes that to
// the "None" enum value it actually uses at runtime. That's an intentional label
// difference, not a distribution mismatch — normalize before comparing.
function normalizeAttention(value: string): string {
  if (value === '—' || value === '') return 'None';
  return value;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  }
  return true;
}

function main() {
  let ok = true;

  const realNames = new Set<string>();
  const realBrokers = new Set<string>();
  const realIdentifiers = new Set<string>();
  const realPolicyNumbers = new Set<string>();

  console.log('=== Distribution check (real vs. seed, per country) ===');

  for (const entry of countryFiles) {
    const filePath = path.join(realDataDir, entry.file);
    if (!fs.existsSync(filePath)) {
      console.log(`\n${entry.country}: SKIPPED (real source file not found at ${filePath})`);
      continue;
    }

    const realRows = parseRealRows(filePath);
    const seedPath = path.join(seedDir, `${entry.country.toLowerCase()}.json`);
    if (!fs.existsSync(seedPath)) {
      console.log(`\n${entry.country}: FAIL — seed file missing at ${seedPath}`);
      ok = false;
      continue;
    }
    const seedRows: Array<Record<string, unknown>> = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

    realRows.forEach((r) => {
      if (r.customerName) realNames.add(r.customerName.toLowerCase());
      if (r.brokerName) realBrokers.add(r.brokerName.toLowerCase());
      if (r.customerIdentifier) realIdentifiers.add(r.customerIdentifier.toLowerCase());
      if (r.policyNumber) realPolicyNumbers.add(r.policyNumber.toLowerCase());
    });

    const countMatch = realRows.length === seedRows.length;
    const realRouting = countBy(realRows, (r) => r.routing);
    const seedRouting = countBy(seedRows, (r) => String(r.routing ?? ''));
    const routingMatch = countsEqual(realRouting, seedRouting);

    const realAttention = countBy(realRows, (r) => normalizeAttention(r.attention));
    const seedAttention = countBy(seedRows, (r) => normalizeAttention(String(r.attention ?? '')));
    const attentionMatch = countsEqual(realAttention, seedAttention);

    const pass = countMatch && routingMatch && attentionMatch;
    ok = ok && pass;

    console.log(`\n${entry.country}: ${pass ? 'PASS' : 'FAIL'}`);
    console.log(`  row count — real=${realRows.length} seed=${seedRows.length} match=${countMatch}`);
    console.log(`  routing   — match=${routingMatch} real=${JSON.stringify(realRouting)} seed=${JSON.stringify(seedRouting)}`);
    console.log(`  attention — match=${attentionMatch} real=${JSON.stringify(realAttention)} seed=${JSON.stringify(seedAttention)}`);
  }

  console.log('\n=== Leak check (current data/seed/all.json vs. all real source files) ===');
  const allSeedPath = path.join(seedDir, 'all.json');
  const allSeed: Array<Record<string, unknown>> = JSON.parse(fs.readFileSync(allSeedPath, 'utf8'));

  const nameLeaks: Array<{ id: unknown; customerName: unknown }> = [];
  const brokerLeaks: Array<{ id: unknown; brokerName: unknown }> = [];
  const identifierLeaks: Array<{ id: unknown; customerIdentifier: unknown }> = [];
  const policyNumberLeaks: Array<{ id: unknown }> = [];

  for (const row of allSeed) {
    const name = String(row.customerName ?? '').toLowerCase();
    const broker = String(row.brokerName ?? '').toLowerCase();
    const identifier = String(row.customerIdentifier ?? '').toLowerCase();
    const policyNo = String(row.id ?? '').toLowerCase();

    if (name && realNames.has(name)) nameLeaks.push({ id: row.id, customerName: row.customerName });
    if (broker && realBrokers.has(broker)) brokerLeaks.push({ id: row.id, brokerName: row.brokerName });
    if (identifier && realIdentifiers.has(identifier)) identifierLeaks.push({ id: row.id, customerIdentifier: row.customerIdentifier });
    if (policyNo && realPolicyNumbers.has(policyNo)) policyNumberLeaks.push({ id: row.id });
  }

  console.log(`Real customer names checked against:   ${realNames.size}`);
  console.log(`Real broker names checked against:     ${realBrokers.size}`);
  console.log(`Real customer identifiers checked against: ${realIdentifiers.size}`);
  console.log(`Real policy numbers checked against:   ${realPolicyNumbers.size}`);

  console.log(`\nCustomer name leaks:       ${nameLeaks.length}`, nameLeaks.length ? JSON.stringify(nameLeaks) : '');
  console.log(`Broker name leaks:         ${brokerLeaks.length}`, brokerLeaks.length ? JSON.stringify(brokerLeaks) : '');
  console.log(`Customer identifier leaks: ${identifierLeaks.length}`, identifierLeaks.length ? JSON.stringify(identifierLeaks) : '');
  console.log(`Policy number leaks:       ${policyNumberLeaks.length}`, policyNumberLeaks.length ? JSON.stringify(policyNumberLeaks) : '');

  const hasLeaks = nameLeaks.length + brokerLeaks.length + identifierLeaks.length + policyNumberLeaks.length > 0;
  ok = ok && !hasLeaks;

  console.log(`\n=== Overall: ${ok ? 'PASS' : 'FAIL'} ===`);
  if (!ok) process.exit(1);
}

main();
