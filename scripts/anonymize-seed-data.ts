import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { read, utils } from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const realDataDir = 'C:/Users/shane.odonoghue/Documents/riskpoint-real-data';
const outputDir = path.join(rootDir, 'data', 'seed');

const countryFiles = [
  { country: 'DK', file: '20260709_DK_RenewalsScreening_004.xlsx' },
  { country: 'NO', file: '20260709_NO_RenewalsScreening_002.xlsx' },
  { country: 'SE', file: '20260709_SE_RenewalsScreening_002.xlsx' },
  { country: 'FI', file: '20260709_FI_RenewalsScreening_002.xlsx' },
] as const;

const headerMap = {
  'Policy No.': 'policyNumber',
  'Customer Name': 'customerName',
  'Customer Identifier': 'customerIdentifier',
  'Broker Name': 'brokerName',
  'End Date (Renewal Due)': 'renewalDate',
  'Currency': 'currency',
  'Premium (incl. tax)': 'premium',
  'Open Claim': 'openClaim',
  'Premium Unpaid': 'premiumUnpaid',
  'Renewal Type Manual': 'renewalTypeManual',
  'System Listed Company': 'systemListedCompany',
  'Is Frame': 'isFrame',
  'D&B No Match': 'dnbNoMatch',
  'D&B Status Inactive': 'dnbStatusInactive',
  'D&B Rating Below A': 'dnbRatingBelowA',
  'Latest Profit Negative': 'latestProfitNegative',
  'Assets Moved >25% YoY': 'assetsMovedSignificant',
  'D&B Listed Company': 'dnbListedCompany',
  'Stage 1 Flags': 'stage1FlagCount',
  'Stage 2 Flags': 'stage2FlagCount',
  'Routing': 'routing',
  'Attention': 'attention',
  'Flag Reasons': 'flagReasons',
} as const;

function buildSyntheticPolicyId(sourcePolicyNumber: unknown, index: number, country: string) {
  const sourceValue = String(sourcePolicyNumber ?? '').trim();
  const hasRpxPrefix = /^RPX/i.test(sourceValue);
  const numericPart = String(index + 10001).padStart(5, '0');

  if (hasRpxPrefix) {
    return `RPX-${country}-${numericPart}`;
  }

  return `${country}-10.101-${numericPart}/25/01`;
}

function buildFakeCompanyName(index: number, country: string) {
  const prefixes = ['Nordic', 'Harbor', 'Blue', 'Arctic', 'Crown', 'Fjord', 'Lumen', 'North', 'Mariner', 'Silver'];
  const descriptors = ['Logistics', 'Industries', 'Holdings', 'Systems', 'Marine', 'Capital', 'Transport', 'Solutions', 'Group', 'Trading'];
  const legalSuffixes = {
    DK: 'ApS',
    NO: 'AS',
    SE: 'AB',
    FI: 'Oy',
  } as const;

  const prefix = prefixes[(index + country.length) % prefixes.length];
  const descriptor = descriptors[(index + 3) % descriptors.length];
  const legalSuffix = legalSuffixes[country as keyof typeof legalSuffixes] ?? 'AB';
  return `${prefix} ${descriptor} ${legalSuffix}`;
}

function buildFakeBroker(index: number) {
  const brokers = ['Nordic Risk Partners', 'Blue Harbor Brokers', 'Arctic Cover Ltd', 'Harborline Insurance', 'Northstar Advisory'];
  return brokers[index % brokers.length];
}

function sanitizeIdentifier(value: string | number | undefined, index: number) {
  if (value === undefined || value === null || value === '') {
    return `ORG-${String(index + 1).padStart(4, '0')}`;
  }
  const text = String(value).trim();
  if (/^\d{8,10}$/.test(text)) {
    return `ORG-${text.slice(-4)}`;
  }
  return `ORG-${text.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase() || `IDX-${index + 1}`}`;
}

function toIsoDate(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const str = String(raw).trim();
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function addMonthsClamped(iso: string, deltaMonths: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const totalMonth = (m - 1) + deltaMonths;
  const newYear = y + Math.floor(totalMonth / 12);
  const newMonth = ((totalMonth % 12) + 12) % 12;
  const lastDayOfNewMonth = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
  const newDay = Math.min(d, lastDayOfNewMonth);
  return `${newYear}-${String(newMonth + 1).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;
}

// Demo-only synthesis (confirmed 2026-07-15, SPEC.md §8): the real source files are
// single-month (Oct 2026), which wouldn't exercise the month-tab bar (§5.2). Deterministically
// (by index, so re-running the script is reproducible) redistribute roughly a third of each
// country's policies one month earlier, a third one month later, and leave a third as-is —
// preserving day-of-month (clamped to the target month's length).
function spreadRenewalDate(iso: string | null, index: number): string | null {
  if (!iso) return iso;
  const bucket = index % 3;
  const deltaMonths = bucket === 0 ? -1 : bucket === 1 ? 0 : 1;
  return addMonthsClamped(iso, deltaMonths);
}

function normalizeCellValue(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return '';
    if (/^Y$/i.test(trimmed)) return true;
    if (/^N$/i.test(trimmed)) return false;
    if (/^[-+]?\d{1,3}(,\d{3})*(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed.replace(/,/g, ''));
    }
    if (/^[-+]?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  }
  if (typeof value === 'number') return value;
  return value;
}

function anonymizePolicy(row: Record<string, unknown>, index: number, country: string) {
  const sourcePolicyNumber = String(row.policyNumber ?? '').trim();
  const policyNo = buildSyntheticPolicyId(sourcePolicyNumber, index, country);
  const isRpx = /^RPX/i.test(sourcePolicyNumber);

  const stage1Flags = {
    openClaim: Boolean(row.openClaim),
    premiumUnpaid: Boolean(row.premiumUnpaid),
    renewalTypeManual: Boolean(row.renewalTypeManual),
    systemListedCompany: Boolean(row.systemListedCompany),
  };

  const stage2Flags = {
    dnbNoMatch: Boolean(row.dnbNoMatch),
    dnbStatusInactive: Boolean(row.dnbStatusInactive),
    dnbRatingBelowA: Boolean(row.dnbRatingBelowA),
    latestProfitNegative: Boolean(row.latestProfitNegative),
    assetsMovedSignificant: Boolean(row.assetsMovedSignificant),
    dnbListedCompany: Boolean(row.dnbListedCompany),
  };

  const flagReasons = String(row.flagReasons ?? '');
  const hasAnyFlag = Object.values(stage1Flags).some(Boolean) || Object.values(stage2Flags).some(Boolean);
  const attention = (() => {
    if (stage1Flags.openClaim || stage1Flags.premiumUnpaid) return 'High';
    if (hasAnyFlag) return 'Medium';
    return 'None';
  })();
  const routing = (() => {
    const hasFlags = Object.values({ ...stage1Flags, ...stage2Flags }).some(Boolean);
    if (hasFlags) return 'Manual Review';
    if (isRpx) return 'RPUX Auto Renew';
    return 'NAVINS Renew';
  })();

  const dnbRating = stage2Flags.dnbRatingBelowA ? 'B3' : 'AA2';
  const latestNetIncome = stage2Flags.latestProfitNegative ? -140000 : 140000;
  const assetsChangePercent = stage2Flags.assetsMovedSignificant ? 30 : 12;
  const premiumValue = Number(row.premium ?? 0);
  const premiumJitter = [0.985, 0.995, 1.005, 1.015, 1.025][(index + country.length) % 5] ?? 1.01;
  const jitteredPremium = Math.round(premiumValue * premiumJitter * 100) / 100;
  const dnbOperatingStatusLabel = stage2Flags.dnbStatusInactive ? 'Inactive' : 'Active';
  const dnbListedExchange = stage2Flags.dnbListedCompany ? 'NASDAQ' : null;

  return {
    id: policyNo,
    country,
    customerName: buildFakeCompanyName(index, country),
    customerIdentifier: sanitizeIdentifier(row.customerIdentifier as string | number | undefined, index),
    brokerName: buildFakeBroker(index),
    renewalDate: spreadRenewalDate(toIsoDate(row.renewalDate), index),
    currency: row.currency ?? 'DKK',
    premium: jitteredPremium,
    openClaim: stage1Flags.openClaim,
    premiumUnpaid: stage1Flags.premiumUnpaid,
    renewalTypeManual: stage1Flags.renewalTypeManual,
    systemListedCompany: stage1Flags.systemListedCompany,
    isFrame: Boolean(row.isFrame),
    dnbNoMatch: stage2Flags.dnbNoMatch,
    dnbStatusInactive: stage2Flags.dnbStatusInactive,
    dnbRatingBelowA: stage2Flags.dnbRatingBelowA,
    latestProfitNegative: stage2Flags.latestProfitNegative,
    assetsMovedSignificant: stage2Flags.assetsMovedSignificant,
    dnbListedCompany: stage2Flags.dnbListedCompany,
    stage1FlagCount: Object.values(stage1Flags).filter(Boolean).length,
    stage2FlagCount: Object.values(stage2Flags).filter(Boolean).length,
    routing,
    attention,
    flagReasons,
    dnbRating,
    failureScorePercentile: flagReasons.includes('Attention: D&B Predictor Concern') ? 25 : 60,
    latestNetIncome,
    assetsChangePercent,
    dnbOperatingStatusLabel,
    dnbListedExchange,
  };
}

function parseWorkbook(filePath: string) {
  const workbook = read(filePath, { type: 'file' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const headerRow = rows[0] as Record<string, unknown> | undefined;

  if (!headerRow) {
    return [];
  }

  const columnFieldMap = new Map<string, string>();
  for (const [rawKey, rawValue] of Object.entries(headerRow)) {
    const headerLabel = String(rawValue).trim();
    const mappedField = headerMap[headerLabel as keyof typeof headerMap];
    if (mappedField) {
      columnFieldMap.set(rawKey, mappedField);
    }
  }

  return rows
    .slice(1)
    .map((row) => {
      const normalized: Record<string, unknown> = {};
      for (const [rawKey, value] of Object.entries(row)) {
        const mappedField = columnFieldMap.get(rawKey);
        if (mappedField) {
          normalized[mappedField] = normalizeCellValue(value);
        }
      }
      return normalized;
    })
    .filter((row) => row.policyNumber || row.customerName || row.routing);
}

function ensureOutputDir() {
  fs.mkdirSync(outputDir, { recursive: true });
}

function main() {
  ensureOutputDir();
  const allPolicies: Array<Record<string, unknown>> = [];
  for (const entry of countryFiles) {
    const filePath = path.join(realDataDir, entry.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing workbook: ${filePath}`);
    }
    const rows = parseWorkbook(filePath);
    const countryPolicies = rows.map((row, index) => anonymizePolicy(row, index, entry.country));
    allPolicies.push(...countryPolicies);
    const outPath = path.join(outputDir, `${entry.country.toLowerCase()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(countryPolicies, null, 2));
    console.log(`Wrote ${countryPolicies.length} policies for ${entry.country} to ${outPath}`);
  }

  const aggregatePath = path.join(outputDir, 'all.json');
  fs.writeFileSync(aggregatePath, JSON.stringify(allPolicies, null, 2));
  console.log(`Wrote aggregate dataset to ${aggregatePath}`);
}

main();
