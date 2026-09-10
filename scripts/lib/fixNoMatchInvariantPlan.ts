// Shared plan-computation logic for correcting existing policies that violate the D&B
// No Match invariant (SPEC.md S3.3/S7.1, added 2026-09-10): when dnbNoMatch is true, D&B
// returned nothing about the company, so dnbStatusInactive, dnbRatingBelowA,
// latestProfitNegative, assetsMovedSignificant, and dnbListedCompany must all be false,
// and dnbRating, latestNetIncome, assetsChangePercent, dnbOperatingStatusLabel, and
// dnbListedExchange must all be null -- there is no other D&B finding to report.
//
// Same shape as scripts/lib/fixRoutingPlan.ts: computeFixNoMatchInvariantPlan() only ever
// issues a SELECT against policies (read-only); applyFixNoMatchInvariantPlan() is the only
// place any UPDATE happens. The generator (scripts/lib/synthesizePlan.ts) cannot produce a
// violating row as of 2026-09-10 (it now runs every draw through the same
// enforceNoMatchInvariant this module uses) -- this module exists to correct rows that
// predate that fix, the way fixRoutingPlan.ts corrects rows from before the routing bug
// was fixed in the generator.

import type { Client } from '@libsql/client'
import {
  enforceNoMatchInvariant,
  violatesNoMatchInvariant,
  computeStage2FlagCount,
  rebuildFlagReasons,
  computeAttention,
  type DnbBooleans,
  type DnbFigures,
} from './dnbRules'

type PolicyRow = {
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

export type InvariantCorrection = {
  id: string
  country: string
  before: Pick<PolicyRow, keyof DnbBooleans | keyof DnbFigures | 'stage2FlagCount' | 'attention' | 'flagReasons'>
  after: Pick<PolicyRow, keyof DnbBooleans | keyof DnbFigures | 'stage2FlagCount' | 'attention' | 'flagReasons'>
}

export type FixNoMatchInvariantPlan = {
  corrections: InvariantCorrection[]
  totalRowsChecked: number
  totalDnbNoMatchRows: number
}

// Read-only: SELECT-only against policies, then pure computation. No INSERT/UPDATE
// anywhere in this function or anything it calls.
export async function computeFixNoMatchInvariantPlan(db: Client): Promise<FixNoMatchInvariantPlan> {
  const result = await db.execute('SELECT * FROM policies')
  const allRows = result.rows as unknown as PolicyRow[]
  return computeFixNoMatchInvariantPlanForRows(allRows)
}

// Same computation, over an in-memory row array -- for data/seed/*.json, which has no
// database to SELECT from (mirrors fixCurrencyPlan.ts's ForRows variant).
export function computeFixNoMatchInvariantPlanForRows(allRows: PolicyRow[]): FixNoMatchInvariantPlan {
  const corrections: InvariantCorrection[] = []

  for (const row of allRows) {
    if (!row.dnbNoMatch) continue
    if (!violatesNoMatchInvariant(row)) continue

    const corrected = enforceNoMatchInvariant(row)
    const stage2FlagCount = computeStage2FlagCount(corrected)
    const flagReasons = rebuildFlagReasons(corrected, row.flagReasons)
    const attention = computeAttention(corrected, (row.attention as 'High' | 'Medium' | 'None' | null) ?? 'None')

    corrections.push({
      id: row.id,
      country: row.country,
      before: {
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
      },
      after: {
        dnbNoMatch: corrected.dnbNoMatch,
        dnbStatusInactive: corrected.dnbStatusInactive,
        dnbRatingBelowA: corrected.dnbRatingBelowA,
        latestProfitNegative: corrected.latestProfitNegative,
        assetsMovedSignificant: corrected.assetsMovedSignificant,
        dnbListedCompany: corrected.dnbListedCompany,
        dnbRating: corrected.dnbRating,
        latestNetIncome: corrected.latestNetIncome,
        assetsChangePercent: corrected.assetsChangePercent,
        dnbOperatingStatusLabel: corrected.dnbOperatingStatusLabel,
        dnbListedExchange: corrected.dnbListedExchange,
        stage2FlagCount,
        attention,
        flagReasons,
      },
    })
  }

  return {
    corrections,
    totalRowsChecked: allRows.length,
    totalDnbNoMatchRows: allRows.filter((r) => r.dnbNoMatch).length,
  }
}

export function printFixNoMatchInvariantPlanReport(plan: FixNoMatchInvariantPlan) {
  console.log(`Rows checked: ${plan.totalRowsChecked}`)
  console.log(`Rows with dnbNoMatch = true: ${plan.totalDnbNoMatchRows}`)

  console.log(`\n=== No Match invariant violations found: ${plan.corrections.length} ===`)
  for (const c of plan.corrections) {
    console.log(`  ${c.id} (${c.country}):`)
    console.log(`    before: statusInactive=${c.before.dnbStatusInactive} ratingBelowA=${c.before.dnbRatingBelowA} profitNeg=${c.before.latestProfitNegative} assetsMoved=${c.before.assetsMovedSignificant} listed=${c.before.dnbListedCompany} rating=${c.before.dnbRating} netIncome=${c.before.latestNetIncome} assetsPct=${c.before.assetsChangePercent} opStatus=${c.before.dnbOperatingStatusLabel} exchange=${c.before.dnbListedExchange} stage2Count=${c.before.stage2FlagCount} attention=${c.before.attention} reasons="${c.before.flagReasons}"`)
    console.log(`    after:  statusInactive=${c.after.dnbStatusInactive} ratingBelowA=${c.after.dnbRatingBelowA} profitNeg=${c.after.latestProfitNegative} assetsMoved=${c.after.assetsMovedSignificant} listed=${c.after.dnbListedCompany} rating=${c.after.dnbRating} netIncome=${c.after.latestNetIncome} assetsPct=${c.after.assetsChangePercent} opStatus=${c.after.dnbOperatingStatusLabel} exchange=${c.after.dnbListedExchange} stage2Count=${c.after.stage2FlagCount} attention=${c.after.attention} reasons="${c.after.flagReasons}"`)
  }
}

// The only place any UPDATE happens. Touches exactly the ten fields named in the
// invariant plus stage2FlagCount/attention/flagReasons, on exactly the rows in
// plan.corrections -- never routing (the routing checker, scripts/lib/fixRoutingPlan.ts,
// is a separate, subsequent pass -- see SPEC.md S8.1/S8.3).
export async function applyFixNoMatchInvariantPlan(db: Client, plan: FixNoMatchInvariantPlan) {
  for (const c of plan.corrections) {
    await db.execute({
      sql: `UPDATE policies SET
        dnbStatusInactive = ?, dnbRatingBelowA = ?, latestProfitNegative = ?, assetsMovedSignificant = ?, dnbListedCompany = ?,
        dnbRating = ?, latestNetIncome = ?, assetsChangePercent = ?, dnbOperatingStatusLabel = ?, dnbListedExchange = ?,
        stage2FlagCount = ?, attention = ?, flagReasons = ?
      WHERE id = ?`,
      args: [
        c.after.dnbStatusInactive, c.after.dnbRatingBelowA, c.after.latestProfitNegative, c.after.assetsMovedSignificant, c.after.dnbListedCompany,
        c.after.dnbRating, c.after.latestNetIncome, c.after.assetsChangePercent, c.after.dnbOperatingStatusLabel, c.after.dnbListedExchange,
        c.after.stage2FlagCount, c.after.attention, c.after.flagReasons,
        c.id,
      ],
    })
  }
}
