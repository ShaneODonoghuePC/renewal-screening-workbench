// Shared plan-computation logic for the two synthesized-data fixes (uneven policy
// counts per country/month, realistic per-company VAT numbers), used by all three
// scripts that touch this: synthesize-data.ts (local.db), dry-run-synthesize-turso.ts
// (Turso, read-only), and apply-synthesize-turso.ts (Turso, apply). Deliberately pulled
// into one shared module rather than copy-pasted three times -- unlike the tiny
// .env.local loader duplicated across the migration scripts, this ~250-line generation
// algorithm being copy-pasted would risk the dry-run and apply computing two different
// plans, which defeats the entire point of reviewing a dry run before applying it.
//
// computeSynthesizePlan() only ever issues SELECT queries (read-only). applySynthesizePlan()
// is the only place any INSERT/UPDATE happens -- dry-run-synthesize-turso.ts imports
// computeSynthesizePlan and nothing else, so it has no write code path in its own
// execution graph at all, the same "read-only by construction" property
// dry-run-migration-turso.ts has.
//
// See the top of synthesize-data.ts for the full rationale behind both fixes.

import type { Client } from '@libsql/client'

const COUNTRIES = ['DK', 'NO', 'SE', 'FI'] as const
export type Country = (typeof COUNTRIES)[number]

const CURRENCY_BY_COUNTRY: Record<Country, string> = { DK: 'DKK', NO: 'NOK', SE: 'SEK', FI: 'EUR' }

// --- deterministic RNG (same mulberry32 + FNV-1a approach as lib/mockRiskQuality.ts) ---
// so re-running the dry run always plans the exact same rows, and a subsequent apply
// (with no other writes to the target DB in between) commits that exact plan.
function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed
  return function random() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

function weightedPick<T extends string>(rand: () => number, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as Array<[T, number]>
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let roll = rand() * total
  for (const [key, w] of entries) {
    roll -= w
    if (roll <= 0) return key
  }
  return entries[entries.length - 1][0]
}

// Two independent ID schemes coexist in this dataset, one per source system: RPUX
// (RPX-{country}-{NNNNN}) and Navins ({country}-10.101-{NNNNN}/25/01). Routing is NOT an
// independent property -- it's fully determined by which source system a policy came
// from plus whether any flag fired (RPUX clean -> RPUX Auto Renew, RPUX flagged ->
// Manual Review; Navins clean -> NAVINS Renew, Navins flagged -> Manual Review),
// confirmed against all 337 original policies with zero exceptions. So a new policy's
// source system has to be decided BEFORE its id or routing can be, and both of those
// then follow deterministically from source system + flags -- never sampled on their own.
function isRpxId(id: string): boolean {
  return /^RPX-[A-Z]{2}-\d+$/.test(id)
}

function isNavinsId(id: string): boolean {
  return /^[A-Z]{2}-10\.101-\d+\/25\/01$/.test(id)
}

function extractIdNumber(id: string): number | null {
  const match = /(\d+)(?:\/\d+\/\d+)?$/.exec(id)
  return match ? Number(match[1]) : null
}

function bernoulli(rand: () => number, rate: number): boolean {
  return rand() < rate
}

function randomDigits(rand: () => number, count: number): string {
  let out = ''
  for (let i = 0; i < count; i++) out += Math.floor(rand() * 10).toString()
  return out
}

// --- VAT number synthesis: real structure per country, fully synthetic digits ---
function buildVat(country: Country, rand: () => number): string {
  if (country === 'DK') return `DK${randomDigits(rand, 8)}`
  if (country === 'FI') return `FI${randomDigits(rand, 8)}`
  if (country === 'NO') return `NO${randomDigits(rand, 9)}MVA`
  return `SE${randomDigits(rand, 10)}01`
}

export type PolicyRow = {
  id: string
  country: string
  customerName: string
  customerIdentifier: string
  brokerName: string
  renewalDate: string | null
  currency: string | null
  premium: number | null
  openClaim: boolean
  premiumUnpaid: boolean
  renewalTypeManual: boolean
  systemListedCompany: boolean
  isFrame: boolean
  dnbNoMatch: boolean
  dnbStatusInactive: boolean
  dnbRatingBelowA: boolean
  latestProfitNegative: boolean
  assetsMovedSignificant: boolean
  dnbListedCompany: boolean
  routing: string
  attention: string | null
  flagReasons: string | null
  dnbRating: string | null
  failureScorePercentile: number | null
  latestNetIncome: number | null
  assetsChangePercent: number | null
  dnbOperatingStatusLabel: string | null
  dnbListedExchange: string | null
}

const FLAG_REASON_LABELS: Array<[keyof PolicyRow, string]> = [
  ['openClaim', 'Open Claim'],
  ['premiumUnpaid', 'Premium Unpaid'],
  ['renewalTypeManual', 'RPUX set to Manual'],
  ['systemListedCompany', 'Listed Company'],
  ['dnbNoMatch', 'D&B No Match'],
  ['dnbRatingBelowA', 'D&B Rating Classification below A'],
  ['latestProfitNegative', 'D&B Negative Profit'],
  ['assetsMovedSignificant', 'D&B Assets Moved >25% YoY'],
  ['dnbListedCompany', 'D&B Listed Company'],
]

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

export type VatUpdate = { id: string; from: string; to: string }

export type SynthesizePlan = {
  allRows: PolicyRow[]
  newPolicies: PolicyRow[]
  vatUpdates: VatUpdate[]
  vatByCompany: Map<string, string>
  beforeAfterByCountryMonth: Array<{ country: Country; month: string; before: number; extra: number }>
}

export function companyKey(country: string, name: string): string {
  return `${country}|${name}`
}

// Rows this same generator already inserted in an earlier run are RPX-prefixed (this
// generator has only ever created RPX ids) but must be excluded when computing each
// country's *original* RPX-vs-Navins proportion below -- otherwise every additional run
// would skew the proportion further toward RPX, compounding on itself. Identified
// structurally, the same way applyFixRoutingPlan left them: zero activity_log/comments
// rows (synthesis never touches either table), and a review_states row (if any -- RPUX
// Auto Renew never gets one) of exactly 'Not Started'/NULL, the same signature
// scripts/lib/fixRoutingPlan.ts used. Restricted to an unbroken run of consecutive
// numbers at the very top of each country's RPX numbering, since nextRpxNumber only ever
// increments by 1 per new row with no gaps or reuse -- a prior synthesis batch can only
// occupy one contiguous block immediately above whatever the original max was.
async function detectPreviouslySynthesizedRpxIds(db: Client, allRows: PolicyRow[]): Promise<Set<string>> {
  const reviewStatesResult = await db.execute('SELECT policyId, status, assignedUserId FROM review_states')
  const reviewStateByPolicyId = new Map<string, { status: string; assignedUserId: string | null }>()
  for (const rs of reviewStatesResult.rows as unknown as Array<{ policyId: string; status: string; assignedUserId: string | null }>) {
    reviewStateByPolicyId.set(rs.policyId, rs)
  }

  const activityCounts = await db.execute('SELECT policyId, COUNT(*) as c FROM activity_log GROUP BY policyId')
  const activityCountByPolicyId = new Map<string, number>()
  for (const r of activityCounts.rows as unknown as Array<{ policyId: string; c: number }>) activityCountByPolicyId.set(r.policyId, Number(r.c))

  const commentCounts = await db.execute('SELECT policyId, COUNT(*) as c FROM comments GROUP BY policyId')
  const commentCountByPolicyId = new Map<string, number>()
  for (const r of commentCounts.rows as unknown as Array<{ policyId: string; c: number }>) commentCountByPolicyId.set(r.policyId, Number(r.c))

  function hasSynthesizedSignature(row: PolicyRow): boolean {
    if (activityCountByPolicyId.get(row.id)) return false
    if (commentCountByPolicyId.get(row.id)) return false
    const rs = reviewStateByPolicyId.get(row.id)
    if (row.routing === 'RPUX Auto Renew') return rs === undefined
    return rs !== undefined && rs.status === 'Not Started' && rs.assignedUserId === null
  }

  const byCountry = new Map<Country, PolicyRow[]>()
  for (const country of COUNTRIES) byCountry.set(country, [])
  for (const row of allRows) byCountry.get(row.country as Country)?.push(row)

  const synthesizedIds = new Set<string>()
  for (const country of COUNTRIES) {
    const numbered = (byCountry.get(country) ?? [])
      .filter((row) => isRpxId(row.id))
      .map((row) => ({ row, num: extractIdNumber(row.id)! }))
      .sort((a, b) => b.num - a.num)

    let expectedNum = numbered[0]?.num
    for (const { row, num } of numbered) {
      if (num !== expectedNum || !hasSynthesizedSignature(row)) break
      synthesizedIds.add(row.id)
      expectedNum = num - 1
    }
  }
  return synthesizedIds
}

// Read-only: SELECT * FROM policies (plus review_states/activity_log/comments, only to
// identify previously-synthesized rows above), then pure computation. No INSERT/UPDATE
// anywhere in this function or anything it calls.
export async function computeSynthesizePlan(db: Client): Promise<SynthesizePlan> {
  const allResult = await db.execute('SELECT * FROM policies')
  const allRows = allResult.rows as unknown as PolicyRow[]

  const previouslySynthesizedIds = await detectPreviouslySynthesizedRpxIds(db, allRows)

  const byCountry = new Map<Country, PolicyRow[]>()
  for (const country of COUNTRIES) byCountry.set(country, [])
  for (const row of allRows) {
    const list = byCountry.get(row.country as Country)
    if (list) list.push(row)
  }

  const newPolicies: PolicyRow[] = []
  const beforeAfterByCountryMonth: SynthesizePlan['beforeAfterByCountryMonth'] = []

  for (const country of COUNTRIES) {
    const rows = byCountry.get(country)!
    if (rows.length === 0) continue

    const rpxNumbers = rows.filter((r) => isRpxId(r.id)).map((r) => extractIdNumber(r.id)!)
    const navinsNumbers = rows.filter((r) => isNavinsId(r.id)).map((r) => extractIdNumber(r.id)!)
    let nextRpxNumber = rpxNumbers.length > 0 ? Math.max(...rpxNumbers) + 1 : 10001
    let nextNavinsNumber = navinsNumbers.length > 0 ? Math.max(...navinsNumbers) + 1 : 10001

    const months = [...new Set(rows.map((r) => (r.renewalDate ?? '').slice(0, 7)).filter(Boolean))].sort()

    // Source-system proportion, from this country's ORIGINAL policies only (excluding
    // any rows a prior run of this same generator already added -- see
    // detectPreviouslySynthesizedRpxIds above). A new policy's source system is sampled
    // from this, then its id and routing both follow deterministically from that choice.
    const originalRows = rows.filter((r) => !previouslySynthesizedIds.has(r.id))
    const sourceSystemCounts = { rpx: 0, navins: 0 }
    for (const r of originalRows) {
      if (isRpxId(r.id)) sourceSystemCounts.rpx++
      else if (isNavinsId(r.id)) sourceSystemCounts.navins++
    }

    const distinctNames = [...new Set(rows.map((r) => r.customerName))]
    const distinctBrokers = [...new Set(rows.map((r) => r.brokerName))]
    const nonzeroPremiums = rows.map((r) => r.premium).filter((p): p is number => !!p && p > 0)

    const flagKeys: Array<keyof PolicyRow> = [
      'openClaim', 'premiumUnpaid', 'renewalTypeManual', 'systemListedCompany',
      'dnbNoMatch', 'dnbStatusInactive', 'dnbRatingBelowA', 'latestProfitNegative',
      'assetsMovedSignificant', 'dnbListedCompany',
    ]
    const flagRates: Record<string, number> = {}
    for (const key of flagKeys) flagRates[key as string] = rows.filter((r) => r[key]).length / rows.length

    const predictorRate = rows.filter((r) => (r.flagReasons ?? '').includes('Predictor Concern')).length / rows.length
    const significantRate = rows.filter((r) => (r.flagReasons ?? '').includes('Significant Event')).length / rows.length
    const listedUnknownRate = rows.filter((r) => (r.flagReasons ?? '').includes('Listed Status Unknown')).length / rows.length

    const avgMonthly = rows.length / Math.max(months.length, 1)
    const spreadCap = Math.max(3, Math.round(avgMonthly * 0.35))

    for (const month of months) {
      const monthRand = mulberry32(hashSeed(`synthesize-policies-v1:${country}:${month}`))
      const extra = 1 + Math.floor(monthRand() * spreadCap)
      const before = rows.filter((r) => (r.renewalDate ?? '').startsWith(month)).length
      beforeAfterByCountryMonth.push({ country, month, before, extra })

      const [year, mo] = month.split('-').map(Number)
      const daysInMonth = lastDayOfMonth(year, mo)

      const rowRand = mulberry32(hashSeed(`synthesize-policies-v1:rows:${country}:${month}`))

      for (let i = 0; i < extra; i++) {
        const customerName = pick(rowRand, distinctNames)
        const brokerName = pick(rowRand, distinctBrokers)
        const day = 1 + Math.floor(rowRand() * daysInMonth)
        const renewalDate = `${year}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const basePremium = nonzeroPremiums.length > 0 ? pick(rowRand, nonzeroPremiums) : 5000
        const jitter = 0.85 + rowRand() * 0.3
        const premium = Math.round(basePremium * jitter * 100) / 100

        const openClaim = bernoulli(rowRand, flagRates.openClaim)
        const premiumUnpaid = bernoulli(rowRand, flagRates.premiumUnpaid)
        const renewalTypeManual = bernoulli(rowRand, flagRates.renewalTypeManual)
        const systemListedCompany = bernoulli(rowRand, flagRates.systemListedCompany)
        const dnbNoMatch = bernoulli(rowRand, flagRates.dnbNoMatch)
        const dnbStatusInactive = bernoulli(rowRand, flagRates.dnbStatusInactive)
        const dnbRatingBelowA = bernoulli(rowRand, flagRates.dnbRatingBelowA)
        const latestProfitNegative = bernoulli(rowRand, flagRates.latestProfitNegative)
        const assetsMovedSignificant = bernoulli(rowRand, flagRates.assetsMovedSignificant)
        const dnbListedCompany = bernoulli(rowRand, flagRates.dnbListedCompany)
        const anyFlagFired = openClaim || premiumUnpaid || renewalTypeManual || systemListedCompany
          || dnbNoMatch || dnbStatusInactive || dnbRatingBelowA || latestProfitNegative
          || assetsMovedSignificant || dnbListedCompany

        // Source system is sampled first (from this country's original RPX-vs-Navins
        // proportion), then id and routing both follow deterministically from source
        // system + whether any flag fired -- never sampled independently of each other,
        // which is how a Navins-style-id row previously ended up marked RPUX Auto Renew
        // and vice versa.
        const sourceSystem = weightedPick(rowRand, sourceSystemCounts)
        const id = sourceSystem === 'rpx'
          ? `RPX-${country}-${String(nextRpxNumber++).padStart(5, '0')}`
          : `${country}-10.101-${String(nextNavinsNumber++).padStart(5, '0')}/25/01`
        const routing = anyFlagFired ? 'Manual Review' : (sourceSystem === 'rpx' ? 'RPUX Auto Renew' : 'NAVINS Renew')
        const isClean = !anyFlagFired

        const newRow: PolicyRow = {
          id,
          country,
          customerName,
          customerIdentifier: '', // filled in from the company->VAT map below
          brokerName,
          renewalDate,
          currency: CURRENCY_BY_COUNTRY[country],
          premium,
          openClaim,
          premiumUnpaid,
          renewalTypeManual,
          systemListedCompany,
          isFrame: false,
          dnbNoMatch,
          dnbStatusInactive,
          dnbRatingBelowA,
          latestProfitNegative,
          assetsMovedSignificant,
          dnbListedCompany,
          routing,
          attention: null,
          flagReasons: null,
          dnbRating: null,
          failureScorePercentile: null,
          latestNetIncome: null,
          assetsChangePercent: null,
          dnbOperatingStatusLabel: null,
          dnbListedExchange: null,
        }

        // Derived fields, same convention verified against 100% of existing rows
        // (see synthesize-data.ts's dry-run report / the analysis behind this script).
        const predictorConcern = !isClean && bernoulli(rowRand, predictorRate)
        const significantEvent = !isClean && bernoulli(rowRand, significantRate)
        const listedStatusUnknown = !isClean && bernoulli(rowRand, listedUnknownRate)

        const reasons: string[] = []
        for (const [key, label] of FLAG_REASON_LABELS) {
          if (newRow[key]) reasons.push(label)
        }
        if (predictorConcern) reasons.push('Attention: D&B Predictor Concern')
        if (significantEvent) reasons.push('Attention: D&B Significant Event')
        if (listedStatusUnknown) reasons.push('Attention: D&B Listed Status Unknown')
        newRow.flagReasons = reasons.length > 0 ? reasons.join(', ') : null

        newRow.attention = newRow.openClaim || newRow.premiumUnpaid
          ? 'High'
          : (newRow.renewalTypeManual || newRow.systemListedCompany || newRow.dnbNoMatch || newRow.dnbRatingBelowA || newRow.latestProfitNegative || newRow.assetsMovedSignificant || newRow.dnbListedCompany)
            ? 'Medium'
            : 'None'

        newRow.dnbRating = newRow.dnbRatingBelowA ? 'B3' : 'AA2'
        newRow.latestNetIncome = newRow.latestProfitNegative ? -140000 : 140000
        newRow.assetsChangePercent = newRow.assetsMovedSignificant ? 30 : 12
        newRow.dnbOperatingStatusLabel = newRow.dnbStatusInactive ? 'Inactive' : 'Active'
        newRow.dnbListedExchange = newRow.dnbListedCompany ? 'NASDAQ' : null

        newPolicies.push(newRow)
      }
    }
  }

  // ---- VAT numbers: one per (country, customerName), covering existing AND new rows ----
  const vatByCompany = new Map<string, string>()
  const usedVats = new Set<string>()

  const allCompanyPairs = new Map<string, Country>()
  for (const row of allRows) allCompanyPairs.set(companyKey(row.country, row.customerName), row.country as Country)
  for (const row of newPolicies) allCompanyPairs.set(companyKey(row.country, row.customerName), row.country as Country)

  for (const [key, country] of [...allCompanyPairs.entries()].sort()) {
    const vatRand = mulberry32(hashSeed(`synthesize-vat-v1:${key}`))
    let vat = buildVat(country, vatRand)
    let attempt = 0
    while (usedVats.has(vat)) {
      attempt++
      vat = buildVat(country, mulberry32(hashSeed(`synthesize-vat-v1:${key}:retry${attempt}`)))
    }
    usedVats.add(vat)
    vatByCompany.set(key, vat)
  }

  for (const row of newPolicies) {
    row.customerIdentifier = vatByCompany.get(companyKey(row.country, row.customerName))!
  }

  const vatUpdates: VatUpdate[] = []
  for (const row of allRows) {
    const newVat = vatByCompany.get(companyKey(row.country, row.customerName))!
    if (newVat !== row.customerIdentifier) {
      vatUpdates.push({ id: row.id, from: row.customerIdentifier, to: newVat })
    }
  }

  return { allRows, newPolicies, vatUpdates, vatByCompany, beforeAfterByCountryMonth }
}

export function printPlanReport(plan: SynthesizePlan) {
  console.log('=== Fix #1: additional policies per country/month ===')
  for (const entry of plan.beforeAfterByCountryMonth) {
    console.log(`  ${entry.country} ${entry.month}: ${entry.before} -> ${entry.before + entry.extra} (+${entry.extra})`)
  }
  const byCountryNewCount: Record<string, number> = {}
  const byCountryRoutingNewCount: Record<string, number> = {}
  for (const row of plan.newPolicies) {
    byCountryNewCount[row.country] = (byCountryNewCount[row.country] ?? 0) + 1
    const rKey = `${row.country} | ${row.routing}`
    byCountryRoutingNewCount[rKey] = (byCountryRoutingNewCount[rKey] ?? 0) + 1
  }
  console.log(`\n  New policies total: ${plan.newPolicies.length}`)
  console.log('  By country:', byCountryNewCount)
  console.log('  By country + routing:', byCountryRoutingNewCount)

  console.log('\n  Sample of new policies (first 5):')
  for (const row of plan.newPolicies.slice(0, 5)) {
    console.log(`    ${row.id}  ${row.country}  ${row.routing}  ${row.customerName} (VAT ${row.customerIdentifier})  ${row.renewalDate}  ${row.currency} ${row.premium}  flags="${row.flagReasons ?? ''}"`)
  }

  console.log('\n=== Fix #2: VAT number regeneration ===')
  console.log(`  Distinct (country, customerName) pairs: ${plan.vatByCompany.size}`)
  console.log(`  Existing policy rows whose customerIdentifier will change: ${plan.vatUpdates.length} / ${plan.allRows.length}`)

  const groupSizes = new Map<string, number>()
  for (const row of plan.allRows) {
    const key = companyKey(row.country, row.customerName)
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1)
  }
  const multiPolicyCompanies = [...groupSizes.entries()].filter(([, count]) => count > 1)
  console.log(`  Companies with 2+ existing policies (these previously had DIFFERENT VATs per policy): ${multiPolicyCompanies.length}`)
  console.log('\n  Sample VAT reassignments (first 10):')
  for (const update of plan.vatUpdates.slice(0, 10)) {
    console.log(`    ${update.id}: "${update.from}" -> "${update.to}"`)
  }

  console.log("\n  Sample: one multi-policy company's policies, showing the unified VAT:")
  if (multiPolicyCompanies.length > 0) {
    const [sampleKey] = multiPolicyCompanies[0]
    const [sampleCountry, sampleName] = sampleKey.split('|')
    const sampleRows = plan.allRows.filter((r) => r.country === sampleCountry && r.customerName === sampleName)
    console.log(`    ${sampleName} (${sampleCountry}), ${sampleRows.length} policies, unified VAT: ${plan.vatByCompany.get(sampleKey)}`)
    for (const r of sampleRows.slice(0, 5)) {
      console.log(`      ${r.id}: old VAT "${r.customerIdentifier}"`)
    }
  }
}

// The only place any INSERT/UPDATE happens. Not imported by dry-run-synthesize-turso.ts.
export async function applySynthesizePlan(db: Client, plan: SynthesizePlan) {
  for (const row of plan.newPolicies) {
    await db.execute({
      sql: `INSERT INTO policies (
        id, country, customerName, customerIdentifier, brokerName, renewalDate, currency, premium,
        openClaim, premiumUnpaid, renewalTypeManual, systemListedCompany, isFrame,
        dnbNoMatch, dnbStatusInactive, dnbRatingBelowA, latestProfitNegative, assetsMovedSignificant, dnbListedCompany,
        stage1FlagCount, stage2FlagCount, routing, attention, flagReasons,
        dnbRating, failureScorePercentile, latestNetIncome, assetsChangePercent, dnbOperatingStatusLabel, dnbListedExchange
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        row.id, row.country, row.customerName, row.customerIdentifier, row.brokerName, row.renewalDate, row.currency, row.premium,
        row.openClaim, row.premiumUnpaid, row.renewalTypeManual, row.systemListedCompany, row.isFrame,
        row.dnbNoMatch, row.dnbStatusInactive, row.dnbRatingBelowA, row.latestProfitNegative, row.assetsMovedSignificant, row.dnbListedCompany,
        [row.openClaim, row.premiumUnpaid, row.renewalTypeManual, row.systemListedCompany].filter(Boolean).length,
        [row.dnbNoMatch, row.dnbStatusInactive, row.dnbRatingBelowA, row.latestProfitNegative, row.assetsMovedSignificant, row.dnbListedCompany].filter(Boolean).length,
        row.routing, row.attention, row.flagReasons,
        row.dnbRating, row.failureScorePercentile, row.latestNetIncome, row.assetsChangePercent, row.dnbOperatingStatusLabel, row.dnbListedExchange,
      ],
    })

    if (row.routing !== 'RPUX Auto Renew') {
      await db.execute({
        sql: `INSERT INTO review_states (policyId, status, assignedUserId) VALUES (?, 'Not Started', NULL)`,
        args: [row.id],
      })
    }
  }

  for (const update of plan.vatUpdates) {
    await db.execute({
      sql: `UPDATE policies SET customerIdentifier = ? WHERE id = ?`,
      args: [update.to, update.id],
    })
  }
}
