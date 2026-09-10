import fs from 'fs'
import path from 'path'

function esc(v: any) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return v.toString()
  return "'" + String(v).replace(/'/g, "''") + "'"
}

function boolToInt(v: any) {
  return v ? 1 : 0
}

function main() {
  const seedPath = path.join(process.cwd(), 'data', 'seed', 'all.json')
  const outPath = path.join(process.cwd(), 'data', 'seed', 'init.sql')
  const raw = fs.readFileSync(seedPath, 'utf8')
  const policies = JSON.parse(raw)

  const create = `-- Generated init SQL for Renewal Screening Workbench\n\nCREATE TABLE IF NOT EXISTS policies (\n  id TEXT PRIMARY KEY,\n  country TEXT,\n  customerName TEXT,\n  customerIdentifier TEXT,\n  brokerName TEXT,\n  renewalDate TEXT,\n  currency TEXT,\n  premium REAL,\n  openClaim INTEGER,\n  premiumUnpaid INTEGER,\n  renewalTypeManual INTEGER,\n  systemListedCompany INTEGER,\n  isFrame INTEGER,\n  dnbNoMatch INTEGER,\n  dnbStatusInactive INTEGER,\n  dnbRatingBelowA INTEGER,\n  latestProfitNegative INTEGER,\n  assetsMovedSignificant INTEGER,\n  dnbListedCompany INTEGER,\n  consolidatedAccounts INTEGER,\n  latestConsolidatedProfitNegative INTEGER,\n  consolidatedAssetsMovedSignificant INTEGER,\n  businessLine TEXT,\n  stage1FlagCount INTEGER,\n  stage2FlagCount INTEGER,\n  routing TEXT,\n  attention TEXT,\n  flagReasons TEXT,\n  dnbRating TEXT,\n  failureScorePercentile INTEGER,\n  latestNetIncome INTEGER,\n  assetsChangePercent INTEGER,\n  dnbOperatingStatusLabel TEXT,\n  dnbListedExchange TEXT\n);\n\nCREATE TABLE IF NOT EXISTS users (\n  id TEXT PRIMARY KEY,\n  name TEXT,\n  country TEXT\n);\n\nCREATE TABLE IF NOT EXISTS review_states (\n  policyId TEXT PRIMARY KEY,\n  status TEXT,\n  assignedUserId TEXT\n);\n\nCREATE TABLE IF NOT EXISTS comments (\n  id TEXT PRIMARY KEY,\n  policyId TEXT,\n  userId TEXT,\n  text TEXT,\n  createdAt TEXT\n);\n\nCREATE TABLE IF NOT EXISTS activity_log (\n  id TEXT PRIMARY KEY,\n  policyId TEXT,\n  eventType TEXT,\n  userId TEXT,\n  detail TEXT,\n  createdAt TEXT\n);\n\n`;

  const countryUserIds: Record<string, string[]> = {
    DK: ['DK-U01', 'DK-U02', 'DK-U03'],
    NO: ['NO-U01', 'NO-U02', 'NO-U03'],
    SE: ['SE-U01', 'SE-U02', 'SE-U03'],
    FI: ['FI-U01', 'FI-U02', 'FI-U03'],
  }

  const manualReviewByCountry: Record<string, string[]> = {}
  for (const r of policies) {
    if (r.routing === 'Manual Review') {
      manualReviewByCountry[r.country] = manualReviewByCountry[r.country] ?? []
      manualReviewByCountry[r.country].push(r.id)
    }
  }

  const assignedPolicyOwners = new Map<string, string | null>()
  for (const country of Object.keys(manualReviewByCountry)) {
    const policyIds = manualReviewByCountry[country]
    const userIds = countryUserIds[country] ?? []
    let roleIndex = 0
    for (let i = 0; i < policyIds.length; i += 1) {
      assignedPolicyOwners.set(
        policyIds[i],
        i % 2 === 0 ? userIds[roleIndex++ % userIds.length] : null
      )
    }
  }

  const inserts: string[] = []
  for (const r of policies) {
    const vals = [
      esc(r.id),
      esc(r.country),
      esc(r.customerName),
      esc(r.customerIdentifier),
      esc(r.brokerName),
      esc(r.renewalDate),
      esc(r.currency),
      esc(r.premium),
      boolToInt(r.openClaim),
      boolToInt(r.premiumUnpaid),
      boolToInt(r.renewalTypeManual),
      boolToInt(r.systemListedCompany),
      boolToInt(r.isFrame),
      boolToInt(r.dnbNoMatch),
      boolToInt(r.dnbStatusInactive),
      boolToInt(r.dnbRatingBelowA),
      boolToInt(r.latestProfitNegative),
      boolToInt(r.assetsMovedSignificant),
      boolToInt(r.dnbListedCompany),
      boolToInt(r.consolidatedAccounts),
      boolToInt(r.latestConsolidatedProfitNegative),
      boolToInt(r.consolidatedAssetsMovedSignificant),
      esc(r.businessLine ?? 'D&O'),
      esc(r.stage1FlagCount ?? 0),
      esc(r.stage2FlagCount ?? 0),
      esc(r.routing),
      esc(r.attention),
      esc(r.flagReasons),
      esc(r.dnbRating),
      esc(r.failureScorePercentile ?? 0),
      esc(r.latestNetIncome ?? 0),
      esc(r.assetsChangePercent ?? 0),
      esc(r.dnbOperatingStatusLabel),
      esc(r.dnbListedExchange),
    ]
    inserts.push(`INSERT INTO policies VALUES (${vals.join(',')});`)

    const defaultStatus = r.routing === 'Manual Review' || r.routing === 'NAVINS Renew' ? 'Not Started' : null
    if (defaultStatus) {
      const assigned = assignedPolicyOwners.get(r.id) ?? null
      inserts.push(`INSERT INTO review_states(policyId,status,assignedUserId) VALUES (${esc(r.id)}, ${esc(defaultStatus)}, ${esc(assigned)});`)
    }
  }

  fs.writeFileSync(outPath, create + inserts.join('\n'))
  console.log(`Wrote SQL dump to ${outPath}`)
}

main()
