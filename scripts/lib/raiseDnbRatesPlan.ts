// Shared plan-computation logic for raising D&B No Match to ~10% of policies and D&B
// Status Inactive to ~3% of MATCHED policies (never on a No Match row -- the invariant in
// scripts/lib/dnbRules.ts forbids that combination by construction here, the same way it
// does in the generator). Selection is deterministic (seeded PRNG, reproducible) and
// stratified per country, so the incidence lands near the target rate in every country
// rather than concentrated in one.
//
// Same shape as scripts/lib/fixCurrencyPlan.ts: a DB-backed compute function
// (computeRaiseDnbRatesPlan) and an in-memory-array variant (computeRaiseDnbRatesPlanForRows,
// for data/seed/*.json, which has no database to SELECT from). applyRaiseDnbRatesPlan is
// the only place any UPDATE happens.
//
// Order matters: No Match rows are selected FIRST, from rows not already dnbNoMatch. D&B
// Status Inactive rows are then selected from whatever remains matched (dnbNoMatch false)
// AFTER removing that run's No Match selections -- so a row can never be selected for both,
// and the invariant (no Stage 2 flag alongside No Match) can never be violated by this
// script's own output.
//
// This module does NOT touch policies.routing. Turning on dnbNoMatch (itself a fired
// flag) or dnbStatusInactive on a previously flag-free RPUX Auto Renew / NAVINS Renew row
// changes whether "any flag fired" for that row's routing rule -- scripts/lib/fixRoutingPlan.ts
// is the existing, separate, already-tested tool for correcting routing after that; run it
// (dry run then apply) after applying this plan. See SPEC.md S8.3.

import type { Client } from '@libsql/client'
import {
  enforceNoMatchInvariant,
  computeStage2FlagCount,
  rebuildFlagReasons,
  computeAttention,
  type DnbBooleans,
  type DnbFigures,
} from './dnbRules'

export const NO_MATCH_TARGET_RATE = 0.1
export const STATUS_INACTIVE_TARGET_RATE_OF_MATCHED = 0.03

const COUNTRIES = ['DK', 'NO', 'SE', 'FI'] as const

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

// Deterministic Fisher-Yates, seeded per country + purpose so the two selections (No
// Match, then Status Inactive) draw from independent streams.
function seededShuffle<T>(items: T[], seedKey: string): T[] {
  const rand = mulberry32(hashSeed(seedKey))
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export type PolicyRow = {
  id: string
  country: string
  openClaim: boolean
  premiumUnpaid: boolean
  renewalTypeManual: boolean
  systemListedCompany: boolean
  attention: string | null
  flagReasons: string | null
  stage2FlagCount: number
} & DnbBooleans & DnbFigures

export type RateFlip = {
  id: string
  country: string
  kind: 'noMatch' | 'statusInactive'
  before: Pick<PolicyRow, keyof DnbBooleans | keyof DnbFigures | 'stage2FlagCount' | 'attention' | 'flagReasons'>
  after: Pick<PolicyRow, keyof DnbBooleans | keyof DnbFigures | 'stage2FlagCount' | 'attention' | 'flagReasons'>
}

export type CountrySummary = {
  country: string
  totalRows: number
  noMatchBefore: number
  noMatchAfter: number
  statusInactiveBefore: number
  statusInactiveAfter: number
}

export type RaiseDnbRatesPlan = {
  flips: RateFlip[]
  countrySummaries: CountrySummary[]
  totalRowsChecked: number
}

function snapshot(row: PolicyRow) {
  return {
    dnbNoMatch: row.dnbNoMatch,
    dnbStatusInactive: row.dnbStatusInactive,
    dnbRatingBelowA: row.dnbRatingBelowA,
    latestProfitNegative: row.latestProfitNegative,
    assetsMovedSignificant: row.assetsMovedSignificant,
    dnbListedCompany: row.dnbListedCompany,
    dnbRating: row.dnbRating,
    latestNetIncome: row.latestNetIncome,
    assetsChangePercent: row.assetsChangePercent,
    dnbOperatingStatusLabel: row.dnbOperatingStatusLabel,
    dnbListedExchange: row.dnbListedExchange,
    stage2FlagCount: row.stage2FlagCount,
    attention: row.attention,
    flagReasons: row.flagReasons,
  }
}

function planFromRows(allRows: PolicyRow[]): RaiseDnbRatesPlan {
  const flips: RateFlip[] = []
  const countrySummaries: CountrySummary[] = []

  const byCountry = new Map<string, PolicyRow[]>()
  for (const country of COUNTRIES) byCountry.set(country, [])
  for (const row of allRows) byCountry.get(row.country)?.push(row)

  for (const country of COUNTRIES) {
    const rows = byCountry.get(country) ?? []
    if (rows.length === 0) continue

    const noMatchBefore = rows.filter((r) => r.dnbNoMatch).length
    const statusInactiveBefore = rows.filter((r) => r.dnbStatusInactive).length

    // --- Step 1: D&B No Match, ~10%, drawn first ---
    const noMatchTarget = Math.round(rows.length * NO_MATCH_TARGET_RATE)
    const noMatchNeeded = Math.max(0, noMatchTarget - noMatchBefore)
    const noMatchCandidates = rows.filter((r) => !r.dnbNoMatch).map((r) => r.id).sort()
    const noMatchSelectedIds = new Set(seededShuffle(noMatchCandidates, `raise-no-match-v1:${country}`).slice(0, noMatchNeeded))

    for (const row of rows) {
      if (!noMatchSelectedIds.has(row.id)) continue
      const before = snapshot(row)
      const corrected = enforceNoMatchInvariant({ ...row, dnbNoMatch: true })
      const stage2FlagCount = computeStage2FlagCount(corrected)
      const flagReasons = rebuildFlagReasons(corrected, row.flagReasons)
      const attention = computeAttention(corrected, (row.attention as 'High' | 'Medium' | 'None' | null) ?? 'None')
      flips.push({
        id: row.id,
        country,
        kind: 'noMatch',
        before,
        after: { ...snapshot(corrected), stage2FlagCount, attention, flagReasons },
      })
    }

    // --- Step 2: D&B Status Inactive, ~3% of what remains matched, drawn from the
    // pool AFTER removing this run's own No Match selections ---
    const remainingMatched = rows.filter((r) => !r.dnbNoMatch && !noMatchSelectedIds.has(r.id))
    const statusInactiveTarget = Math.round(remainingMatched.length * STATUS_INACTIVE_TARGET_RATE_OF_MATCHED)
    const statusInactiveAlreadyInPool = remainingMatched.filter((r) => r.dnbStatusInactive).length
    const statusInactiveNeeded = Math.max(0, statusInactiveTarget - statusInactiveAlreadyInPool)
    const statusInactiveCandidates = remainingMatched.filter((r) => !r.dnbStatusInactive).map((r) => r.id).sort()
    const statusInactiveSelectedIds = new Set(
      seededShuffle(statusInactiveCandidates, `raise-status-inactive-v1:${country}`).slice(0, statusInactiveNeeded),
    )

    for (const row of rows) {
      if (!statusInactiveSelectedIds.has(row.id)) continue
      const before = snapshot(row)
      const corrected: PolicyRow = { ...row, dnbStatusInactive: true, dnbOperatingStatusLabel: 'Inactive' }
      const stage2FlagCount = computeStage2FlagCount(corrected)
      const flagReasons = rebuildFlagReasons(corrected, row.flagReasons)
      const attention = computeAttention(corrected, (row.attention as 'High' | 'Medium' | 'None' | null) ?? 'None')
      flips.push({
        id: row.id,
        country,
        kind: 'statusInactive',
        before,
        after: { ...snapshot(corrected), stage2FlagCount, attention, flagReasons },
      })
    }

    countrySummaries.push({
      country,
      totalRows: rows.length,
      noMatchBefore,
      noMatchAfter: noMatchBefore + noMatchSelectedIds.size,
      statusInactiveBefore,
      statusInactiveAfter: statusInactiveBefore + statusInactiveSelectedIds.size,
    })
  }

  return { flips, countrySummaries, totalRowsChecked: allRows.length }
}

// Read-only: SELECT-only against policies, then pure computation. No INSERT/UPDATE
// anywhere in this function or anything it calls.
export async function computeRaiseDnbRatesPlan(db: Client): Promise<RaiseDnbRatesPlan> {
  const result = await db.execute('SELECT * FROM policies')
  return planFromRows(result.rows as unknown as PolicyRow[])
}

// Same plan computation, over an in-memory array -- used by the seed-file version of this
// script, which has no database to query.
export function computeRaiseDnbRatesPlanForRows(rows: PolicyRow[]): RaiseDnbRatesPlan {
  return planFromRows(rows)
}

export function printRaiseDnbRatesPlanReport(plan: RaiseDnbRatesPlan) {
  console.log(`Rows checked: ${plan.totalRowsChecked}`)
  console.log('\n=== Per-country before/after ===')
  let totalNoMatchBefore = 0
  let totalNoMatchAfter = 0
  let totalStatusInactiveBefore = 0
  let totalStatusInactiveAfter = 0
  for (const s of plan.countrySummaries) {
    console.log(
      `  ${s.country}: ${s.totalRows} rows -- No Match ${s.noMatchBefore} -> ${s.noMatchAfter} (${((s.noMatchAfter / s.totalRows) * 100).toFixed(1)}%), Status Inactive ${s.statusInactiveBefore} -> ${s.statusInactiveAfter}`,
    )
    totalNoMatchBefore += s.noMatchBefore
    totalNoMatchAfter += s.noMatchAfter
    totalStatusInactiveBefore += s.statusInactiveBefore
    totalStatusInactiveAfter += s.statusInactiveAfter
  }
  console.log(`\n  Total No Match: ${totalNoMatchBefore} -> ${totalNoMatchAfter} / ${plan.totalRowsChecked} (${((totalNoMatchAfter / plan.totalRowsChecked) * 100).toFixed(1)}%)`)
  console.log(`  Total Status Inactive: ${totalStatusInactiveBefore} -> ${totalStatusInactiveAfter}`)

  const noMatchFlips = plan.flips.filter((f) => f.kind === 'noMatch')
  const statusInactiveFlips = plan.flips.filter((f) => f.kind === 'statusInactive')
  console.log(`\n=== No Match flips: ${noMatchFlips.length} ===`)
  for (const f of noMatchFlips) console.log(`  ${f.id} (${f.country})`)
  console.log(`\n=== Status Inactive flips: ${statusInactiveFlips.length} ===`)
  for (const f of statusInactiveFlips) console.log(`  ${f.id} (${f.country})`)
}

// The only place any UPDATE happens. Touches exactly the ten invariant-relevant fields
// plus stage2FlagCount/attention/flagReasons, on exactly the rows in plan.flips -- never
// routing (see this file's header comment -- run the routing fixer afterward).
export async function applyRaiseDnbRatesPlan(db: Client, plan: RaiseDnbRatesPlan) {
  for (const f of plan.flips) {
    await db.execute({
      sql: `UPDATE policies SET
        dnbNoMatch = ?, dnbStatusInactive = ?, dnbRatingBelowA = ?, latestProfitNegative = ?, assetsMovedSignificant = ?, dnbListedCompany = ?,
        dnbRating = ?, latestNetIncome = ?, assetsChangePercent = ?, dnbOperatingStatusLabel = ?, dnbListedExchange = ?,
        stage2FlagCount = ?, attention = ?, flagReasons = ?
      WHERE id = ?`,
      args: [
        f.after.dnbNoMatch, f.after.dnbStatusInactive, f.after.dnbRatingBelowA, f.after.latestProfitNegative, f.after.assetsMovedSignificant, f.after.dnbListedCompany,
        f.after.dnbRating, f.after.latestNetIncome, f.after.assetsChangePercent, f.after.dnbOperatingStatusLabel, f.after.dnbListedExchange,
        f.after.stage2FlagCount, f.after.attention, f.after.flagReasons,
        f.id,
      ],
    })
  }
}
