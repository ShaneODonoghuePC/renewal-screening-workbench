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

// Read-only: SELECT * FROM policies, then pure computation. No INSERT/UPDATE anywhere
// in this function or anything it calls.
export async function computeSynthesizePlan(db: Client): Promise<SynthesizePlan> {
  const allResult = await db.execute('SELECT * FROM policies')
  const allRows = allResult.rows as unknown as PolicyRow[]

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

    const idNumbers = rows
      .map((r) => /(\d{4,6})(?:\/\d+\/\d+)?$/.exec(r.id)?.[1])
      .filter((n): n is string => !!n)
      .map(Number)
    let nextNumber = Math.max(...idNumbers) + 1

    const months = [...new Set(rows.map((r) => (r.renewalDate ?? '').slice(0, 7)).filter(Boolean))].sort()

    const routingCounts: Record<string, number> = {}
    for (const r of rows) routingCounts[r.routing] = (routingCounts[r.routing] ?? 0) + 1
    // Weights for choosing between the two flagged-routing buckets, once we already
    // know a row has at least one flag fired. Excludes RPUX Auto Renew entirely --
    // that bucket is reached only via the no-flags-fired branch below.
    const flaggedRoutingCounts: Record<string, number> = {}
    for (const [key, count] of Object.entries(routingCounts)) {
      if (key !== 'RPUX Auto Renew') flaggedRoutingCounts[key] = count
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
        const idNum = nextNumber++
        const id = `RPX-${country}-${String(idNum).padStart(5, '0')}`
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
        // Routing is derived from whether any flag actually fired -- clean policies
        // auto-renew, anything flagged goes to a review queue -- rather than sampled
        // independently of the flags, which could (and did) produce contradictions
        // like a flagged row on RPUX Auto Renew or a flag-free row on Manual Review.
        const anyFlagFired = openClaim || premiumUnpaid || renewalTypeManual || systemListedCompany
          || dnbNoMatch || dnbStatusInactive || dnbRatingBelowA || latestProfitNegative
          || assetsMovedSignificant || dnbListedCompany
        const routing = anyFlagFired
          ? weightedPick(rowRand, flaggedRoutingCounts as Record<string, number>)
          : 'RPUX Auto Renew'
        const isAutoRenew = !anyFlagFired

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
        const predictorConcern = !isAutoRenew && bernoulli(rowRand, predictorRate)
        const significantEvent = !isAutoRenew && bernoulli(rowRand, significantRate)
        const listedStatusUnknown = !isAutoRenew && bernoulli(rowRand, listedUnknownRate)

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
