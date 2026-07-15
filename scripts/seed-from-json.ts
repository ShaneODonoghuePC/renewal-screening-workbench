import fs from 'fs'
import path from 'path'
import { libsqlClient } from '../lib/db/client.js'

type Policy = {
  [k: string]: any
}

const userRoster = [
  { id: 'DK-U01', name: 'Anna Jensen', country: 'DK' },
  { id: 'DK-U02', name: 'Mikkel Sørensen', country: 'DK' },
  { id: 'DK-U03', name: 'Sara Rasmussen', country: 'DK' },
  { id: 'NO-U01', name: 'Erik Hansen', country: 'NO' },
  { id: 'NO-U02', name: 'Ingrid Nilsen', country: 'NO' },
  { id: 'NO-U03', name: 'Kjetil Berg', country: 'NO' },
  { id: 'SE-U01', name: 'Lena Andersson', country: 'SE' },
  { id: 'SE-U02', name: 'Johan Lindström', country: 'SE' },
  { id: 'SE-U03', name: 'Maja Eriksson', country: 'SE' },
  { id: 'FI-U01', name: 'Aino Korhonen', country: 'FI' },
  { id: 'FI-U02', name: 'Mikko Laine', country: 'FI' },
  { id: 'FI-U03', name: 'Sofia Virtanen', country: 'FI' },
]

async function main() {
  const jsonPath = path.resolve(process.cwd(), 'data', 'seed', 'all.json')
  const raw = fs.readFileSync(jsonPath, 'utf8')
  const items: Policy[] = JSON.parse(raw)
  console.log('Seeding', items.length, 'policies and', userRoster.length, 'users')

  const manualReviewByCountry: Record<string, string[]> = {}
  for (const item of items) {
    if (item.routing === 'Manual Review') {
      manualReviewByCountry[item.country] = manualReviewByCountry[item.country] ?? []
      manualReviewByCountry[item.country].push(item.id)
    }
  }

  const countryUserIds: Record<string, string[]> = {
    DK: ['DK-U01', 'DK-U02', 'DK-U03'],
    NO: ['NO-U01', 'NO-U02', 'NO-U03'],
    SE: ['SE-U01', 'SE-U02', 'SE-U03'],
    FI: ['FI-U01', 'FI-U02', 'FI-U03'],
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

  const stmts: Array<[string, any[]]> = []

  for (const u of userRoster) {
    stmts.push([
      'INSERT OR REPLACE INTO users (id, name, country) VALUES (?,?,?)',
      [u.id, u.name, u.country],
    ])
  }

  for (const p of items) {
    const cols = [
      'id','country','customerName','customerIdentifier','brokerName','renewalDate','currency','premium',
      'openClaim','premiumUnpaid','renewalTypeManual','systemListedCompany','isFrame','dnbNoMatch','dnbStatusInactive',
      'dnbRatingBelowA','latestProfitNegative','assetsMovedSignificant','dnbListedCompany','stage1FlagCount','stage2FlagCount',
      'routing','attention','flagReasons','dnbRating','failureScorePercentile','latestNetIncome','assetsChangePercent','dnbOperatingStatusLabel','dnbListedExchange'
    ]
    const placeholders = cols.map(()=>'?').join(',')
    const sql = `INSERT OR REPLACE INTO policies (${cols.join(',')}) VALUES (${placeholders})`

    const args = [
      p.id || null,
      p.country || null,
      p.customerName || null,
      p.customerIdentifier || null,
      p.brokerName || null,
      p.renewalDate || null,
      p.currency || null,
      p.premium ?? null,
      p.openClaim ? 1 : 0,
      p.premiumUnpaid ? 1 : 0,
      p.renewalTypeManual ? 1 : 0,
      p.systemListedCompany ? 1 : 0,
      p.isFrame ? 1 : 0,
      p.dnbNoMatch ? 1 : 0,
      p.dnbStatusInactive ? 1 : 0,
      p.dnbRatingBelowA ? 1 : 0,
      p.latestProfitNegative ? 1 : 0,
      p.assetsMovedSignificant ? 1 : 0,
      p.dnbListedCompany ? 1 : 0,
      p.stage1FlagCount ?? 0,
      p.stage2FlagCount ?? 0,
      p.routing || null,
      p.attention || null,
      p.flagReasons || null,
      p.dnbRating || null,
      p.failureScorePercentile ?? null,
      p.latestNetIncome ?? null,
      p.assetsChangePercent ?? null,
      p.dnbOperatingStatusLabel || null,
      p.dnbListedExchange || null,
    ]

    stmts.push([sql, args])

    const defaultStatus = p.routing === 'Manual Review' ? 'New' : (p.routing === 'NAVINS Renew' ? 'Pending' : null)
    if (defaultStatus) {
      const assigned = assignedPolicyOwners.get(p.id) ?? null
      stmts.push([
        'INSERT OR REPLACE INTO review_states (policyId, status, assignedUserId) VALUES (?,?,?)',
        [p.id, defaultStatus, assigned],
      ])
    }
  }

  try {
    // run in a transaction
    await libsqlClient.batch(stmts, 'deferred')
    console.log('Seeding complete')
  } catch (e) {
    console.error('Seeding failed:', e)
    process.exit(1)
  }
}

main()
