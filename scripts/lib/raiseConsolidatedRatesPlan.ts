// Shared plan-computation logic for setting the initial incidence of the three
// consolidated-accounts fields (SPEC.md S3.3, added 2026-09-11), deterministically and
// stratified per country: Consolidated Accounts ~18% of policies; among those, Latest
// Consolidated Profit Negative ~40% and Consolidated Assets Moved >25% YoY ~15%, drawn
// independently of each other (a policy can carry both, one, or neither).
//
// Same shape as scripts/lib/raiseDnbRatesPlan.ts. Unlike that module, this one starts
// every row from false (these are brand-new columns, not an existing partial rate being
// raised further) -- the "already true" subtraction logic is kept anyway so a second run
// against rows that already carry a true value is idempotent rather than double-counting.
//
// The two dependent flags are only ever drawn for rows selected into the Consolidated
// Accounts pool, so the consolidated invariant (scripts/lib/dnbRules.ts) can never be
// violated by this script's own output -- no separate enforcement call is needed here the
// way enforceNoMatchInvariant is needed in raiseDnbRatesPlan.ts, because selection order
// already guarantees it.
//
// Deliberately does NOT touch policies.attention -- per the brief, attention is
// unaffected by this addition (only Open Claim / Premium Unpaid reach High, and the two
// new scoring flags are not wired into the Medium trigger; see SPEC.md S3.2's note on
// this deliberate scope decision). stage2FlagCount and flagReasons ARE recomputed, since
// the two dependent flags genuinely score and do appear in Flag Reasons.
//
// This module does NOT touch policies.routing either. The two dependent flags are new
// routing triggers (SPEC.md S3.1) -- run scripts/lib/fixRoutingPlan.ts (dry run then
// apply) after applying this plan, same as raiseDnbRatesPlan.ts's own routing knock-on.

import type { Client } from '@libsql/client'
import {
  computeStage2FlagCount,
  rebuildFlagReasons,
  type DnbBooleans,
  type ConsolidatedBooleans,
} from './dnbRules'

export const CONSOLIDATED_ACCOUNTS_TARGET_RATE = 0.18
export const CONSOLIDATED_PROFIT_NEGATIVE_TARGET_RATE_OF_CONSOLIDATED = 0.4
export const CONSOLIDATED_ASSETS_MOVED_TARGET_RATE_OF_CONSOLIDATED = 0.15

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
  flagReasons: string | null
  stage2FlagCount: number
} & DnbBooleans & ConsolidatedBooleans

export type ConsolidatedFlip = {
  id: string
  country: string
  before: Pick<PolicyRow, keyof ConsolidatedBooleans | 'stage2FlagCount' | 'flagReasons'>
  after: Pick<PolicyRow, keyof ConsolidatedBooleans | 'stage2FlagCount' | 'flagReasons'>
}

export type CountrySummary = {
  country: string
  totalRows: number
  consolidatedAccountsBefore: number
  consolidatedAccountsAfter: number
  profitNegativeBefore: number
  profitNegativeAfter: number
  assetsMovedBefore: number
  assetsMovedAfter: number
}

export type RaiseConsolidatedRatesPlan = {
  flips: ConsolidatedFlip[]
  countrySummaries: CountrySummary[]
  totalRowsChecked: number
}

function snapshot(row: PolicyRow) {
  return {
    consolidatedAccounts: row.consolidatedAccounts,
    latestConsolidatedProfitNegative: row.latestConsolidatedProfitNegative,
    consolidatedAssetsMovedSignificant: row.consolidatedAssetsMovedSignificant,
    stage2FlagCount: row.stage2FlagCount,
    flagReasons: row.flagReasons,
  }
}

function planFromRows(allRows: PolicyRow[]): RaiseConsolidatedRatesPlan {
  const flipsById = new Map<string, ConsolidatedFlip>()
  const countrySummaries: CountrySummary[] = []

  const byCountry = new Map<string, PolicyRow[]>()
  for (const country of COUNTRIES) byCountry.set(country, [])
  for (const row of allRows) byCountry.get(row.country)?.push(row)

  for (const country of COUNTRIES) {
    const rows = byCountry.get(country) ?? []
    if (rows.length === 0) continue

    const consolidatedAccountsBefore = rows.filter((r) => r.consolidatedAccounts).length

    // --- Step 1: Consolidated Accounts, ~18% ---
    // Candidates exclude dnbNoMatch rows (2026-09-16, was missing -- the actual cause of
    // 7 dnbNoMatch=true rows getting consolidatedAccounts=true when this ran before:
    // D&B reported nothing about a company it never matched, consolidated accounts
    // included, so those rows were never eligible in the first place -- see
    // scripts/lib/dnbRules.ts's enforceConsolidatedInvariant for the invariant this now
    // can't violate by construction).
    const target = Math.round(rows.length * CONSOLIDATED_ACCOUNTS_TARGET_RATE)
    const needed = Math.max(0, target - consolidatedAccountsBefore)
    const candidates = rows.filter((r) => !r.consolidatedAccounts && !r.dnbNoMatch).map((r) => r.id).sort()
    const selectedIds = new Set(seededShuffle(candidates, `raise-consolidated-accounts-v1:${country}`).slice(0, needed))

    const consolidatedPool = rows.filter((r) => r.consolidatedAccounts || selectedIds.has(r.id))
    const profitNegativeBefore = consolidatedPool.filter((r) => r.latestConsolidatedProfitNegative).length
    const assetsMovedBefore = consolidatedPool.filter((r) => r.consolidatedAssetsMovedSignificant).length

    // --- Step 2: the two dependent flags, drawn independently, ONLY from the
    // consolidated pool (existing-true rows plus this run's new selections) ---
    const profitTarget = Math.round(consolidatedPool.length * CONSOLIDATED_PROFIT_NEGATIVE_TARGET_RATE_OF_CONSOLIDATED)
    const profitNeeded = Math.max(0, profitTarget - profitNegativeBefore)
    const profitCandidates = consolidatedPool.filter((r) => !r.latestConsolidatedProfitNegative).map((r) => r.id).sort()
    const profitSelectedIds = new Set(seededShuffle(profitCandidates, `raise-consolidated-profit-v1:${country}`).slice(0, profitNeeded))

    const assetsTarget = Math.round(consolidatedPool.length * CONSOLIDATED_ASSETS_MOVED_TARGET_RATE_OF_CONSOLIDATED)
    const assetsNeeded = Math.max(0, assetsTarget - assetsMovedBefore)
    const assetsCandidates = consolidatedPool.filter((r) => !r.consolidatedAssetsMovedSignificant).map((r) => r.id).sort()
    const assetsSelectedIds = new Set(seededShuffle(assetsCandidates, `raise-consolidated-assets-v1:${country}`).slice(0, assetsNeeded))

    for (const row of consolidatedPool) {
      const willConsolidatedAccounts = true
      const willProfitNegative = row.latestConsolidatedProfitNegative || profitSelectedIds.has(row.id)
      const willAssetsMoved = row.consolidatedAssetsMovedSignificant || assetsSelectedIds.has(row.id)
      if (
        row.consolidatedAccounts === willConsolidatedAccounts &&
        row.latestConsolidatedProfitNegative === willProfitNegative &&
        row.consolidatedAssetsMovedSignificant === willAssetsMoved
      ) {
        continue // nothing changed on this row
      }

      const before = snapshot(row)
      const corrected: PolicyRow = {
        ...row,
        consolidatedAccounts: willConsolidatedAccounts,
        latestConsolidatedProfitNegative: willProfitNegative,
        consolidatedAssetsMovedSignificant: willAssetsMoved,
      }
      const stage2FlagCount = computeStage2FlagCount(corrected)
      const flagReasons = rebuildFlagReasons(corrected, row.flagReasons)
      flipsById.set(row.id, {
        id: row.id,
        country,
        before,
        after: { ...snapshot(corrected), stage2FlagCount, flagReasons },
      })
    }

    countrySummaries.push({
      country,
      totalRows: rows.length,
      consolidatedAccountsBefore,
      consolidatedAccountsAfter: consolidatedAccountsBefore + selectedIds.size,
      profitNegativeBefore,
      profitNegativeAfter: profitNegativeBefore + profitSelectedIds.size,
      assetsMovedBefore,
      assetsMovedAfter: assetsMovedBefore + assetsSelectedIds.size,
    })
  }

  return { flips: [...flipsById.values()], countrySummaries, totalRowsChecked: allRows.length }
}

// Read-only: SELECT-only against policies, then pure computation. No INSERT/UPDATE
// anywhere in this function or anything it calls.
export async function computeRaiseConsolidatedRatesPlan(db: Client): Promise<RaiseConsolidatedRatesPlan> {
  const result = await db.execute('SELECT * FROM policies')
  return planFromRows(result.rows as unknown as PolicyRow[])
}

// Same plan computation, over an in-memory array -- for data/seed/*.json.
export function computeRaiseConsolidatedRatesPlanForRows(rows: PolicyRow[]): RaiseConsolidatedRatesPlan {
  return planFromRows(rows)
}

export function printRaiseConsolidatedRatesPlanReport(plan: RaiseConsolidatedRatesPlan) {
  console.log(`Rows checked: ${plan.totalRowsChecked}`)
  console.log('\n=== Per-country before/after ===')
  let totals = { ca0: 0, ca1: 0, pn0: 0, pn1: 0, am0: 0, am1: 0 }
  for (const s of plan.countrySummaries) {
    console.log(
      `  ${s.country}: ${s.totalRows} rows -- Consolidated Accounts ${s.consolidatedAccountsBefore} -> ${s.consolidatedAccountsAfter} (${((s.consolidatedAccountsAfter / s.totalRows) * 100).toFixed(1)}%), ` +
        `Profit Negative (of consolidated) ${s.profitNegativeBefore} -> ${s.profitNegativeAfter}, Assets Moved (of consolidated) ${s.assetsMovedBefore} -> ${s.assetsMovedAfter}`,
    )
    totals.ca0 += s.consolidatedAccountsBefore
    totals.ca1 += s.consolidatedAccountsAfter
    totals.pn0 += s.profitNegativeBefore
    totals.pn1 += s.profitNegativeAfter
    totals.am0 += s.assetsMovedBefore
    totals.am1 += s.assetsMovedAfter
  }
  console.log(`\n  Total Consolidated Accounts: ${totals.ca0} -> ${totals.ca1} / ${plan.totalRowsChecked} (${((totals.ca1 / plan.totalRowsChecked) * 100).toFixed(1)}%)`)
  console.log(`  Total Profit Negative (of consolidated): ${totals.pn0} -> ${totals.pn1} (${totals.ca1 > 0 ? ((totals.pn1 / totals.ca1) * 100).toFixed(1) : '0.0'}% of consolidated)`)
  console.log(`  Total Assets Moved (of consolidated): ${totals.am0} -> ${totals.am1} (${totals.ca1 > 0 ? ((totals.am1 / totals.ca1) * 100).toFixed(1) : '0.0'}% of consolidated)`)

  console.log(`\n=== Flips: ${plan.flips.length} ===`)
  for (const f of plan.flips) {
    console.log(`  ${f.id} (${f.country}): accounts=${f.after.consolidatedAccounts} profitNeg=${f.after.latestConsolidatedProfitNegative} assetsMoved=${f.after.consolidatedAssetsMovedSignificant}`)
  }
}

// The only place any UPDATE happens. Touches exactly the three consolidated booleans
// plus stage2FlagCount/flagReasons -- never attention (see this file's header comment),
// never routing (run the routing fixer afterward).
export async function applyRaiseConsolidatedRatesPlan(db: Client, plan: RaiseConsolidatedRatesPlan) {
  for (const f of plan.flips) {
    await db.execute({
      sql: `UPDATE policies SET
        consolidatedAccounts = ?, latestConsolidatedProfitNegative = ?, consolidatedAssetsMovedSignificant = ?,
        stage2FlagCount = ?, flagReasons = ?
      WHERE id = ?`,
      args: [
        f.after.consolidatedAccounts, f.after.latestConsolidatedProfitNegative, f.after.consolidatedAssetsMovedSignificant,
        f.after.stage2FlagCount, f.after.flagReasons,
        f.id,
      ],
    })
  }
}
