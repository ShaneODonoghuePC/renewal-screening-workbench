// Shared plan-computation logic for correcting existing policies that violate the
// consolidated-accounts invariant (SPEC.md S3.3/S7.1) -- now two rules (see
// scripts/lib/dnbRules.ts for the full reasoning on both):
// (a) added 2026-09-11: the two dependent flags (latestConsolidatedProfitNegative,
//     consolidatedAssetsMovedSignificant) can only be true where consolidatedAccounts
//     is true.
// (b) added 2026-09-16, fixing a real data bug this checker did not catch until now:
//     when dnbNoMatch is true, ALL THREE consolidated fields (consolidatedAccounts
//     included) must be false -- D&B reported nothing about a company it never
//     matched. This checker previously skipped any row with consolidatedAccounts =
//     true outright (`if (row.consolidatedAccounts) continue`), which is exactly why
//     rule (b) violations were never found: they all have consolidatedAccounts = true
//     by definition. That skip is gone.
//
// Same shape as scripts/lib/fixNoMatchInvariantPlan.ts: computeFixConsolidatedInvariantPlan()
// only ever issues a SELECT against policies (read-only); applyFixConsolidatedInvariantPlan()
// is the only place any UPDATE happens. The generator (scripts/lib/synthesizePlan.ts) now
// enforces both halves of the invariant at the point it draws these booleans, and
// scripts/lib/raiseConsolidatedRatesPlan.ts's candidate selection now excludes dnbNoMatch
// rows (2026-09-16, previously didn't -- the actual source of the 7 violations this file
// found and corrected) -- this module remains the read-only-checker-plus-apply-step
// safety net for whatever predates those fixes.

import type { Client } from '@libsql/client'
import {
  enforceConsolidatedInvariant,
  violatesConsolidatedInvariant,
  computeStage2FlagCount,
  rebuildFlagReasons,
  type DnbBooleans,
  type ConsolidatedBooleans,
} from './dnbRules'

// rebuildFlagReasons rebuilds the FULL reasons string (every fired Stage 1/Stage 2 flag,
// not just the consolidated trio), so this row type carries every boolean
// FLAG_REASON_LABELS can name -- a row typed with only ConsolidatedBooleans would silently
// rebuild flagReasons down to just the consolidated entries, dropping every other
// already-fired flag's reason string.
type PolicyRow = {
  id: string
  country: string
  openClaim: boolean
  premiumUnpaid: boolean
  renewalTypeManual: boolean
  systemListedCompany: boolean
  flagReasons: string | null
  stage2FlagCount: number
} & DnbBooleans & ConsolidatedBooleans

export type ConsolidatedInvariantCorrection = {
  id: string
  country: string
  before: Pick<PolicyRow, keyof ConsolidatedBooleans | 'stage2FlagCount' | 'flagReasons'>
  after: Pick<PolicyRow, keyof ConsolidatedBooleans | 'stage2FlagCount' | 'flagReasons'>
}

export type FixConsolidatedInvariantPlan = {
  corrections: ConsolidatedInvariantCorrection[]
  totalRowsChecked: number
  totalConsolidatedAccountsRows: number
}

// Read-only: SELECT-only against policies, then pure computation. No INSERT/UPDATE
// anywhere in this function or anything it calls.
export async function computeFixConsolidatedInvariantPlan(db: Client): Promise<FixConsolidatedInvariantPlan> {
  const result = await db.execute('SELECT * FROM policies')
  return computeFixConsolidatedInvariantPlanForRows(result.rows as unknown as PolicyRow[])
}

// Same computation, over an in-memory row array -- for data/seed/*.json, which has no
// database to SELECT from.
export function computeFixConsolidatedInvariantPlanForRows(allRows: PolicyRow[]): FixConsolidatedInvariantPlan {
  const corrections: ConsolidatedInvariantCorrection[] = []

  for (const row of allRows) {
    if (!violatesConsolidatedInvariant(row)) continue

    const corrected = enforceConsolidatedInvariant(row)
    const stage2FlagCount = computeStage2FlagCount(corrected)
    const flagReasons = rebuildFlagReasons(corrected, row.flagReasons)

    corrections.push({
      id: row.id,
      country: row.country,
      before: {
        consolidatedAccounts: row.consolidatedAccounts,
        latestConsolidatedProfitNegative: row.latestConsolidatedProfitNegative,
        consolidatedAssetsMovedSignificant: row.consolidatedAssetsMovedSignificant,
        stage2FlagCount: row.stage2FlagCount,
        flagReasons: row.flagReasons,
      },
      after: {
        consolidatedAccounts: corrected.consolidatedAccounts,
        latestConsolidatedProfitNegative: corrected.latestConsolidatedProfitNegative,
        consolidatedAssetsMovedSignificant: corrected.consolidatedAssetsMovedSignificant,
        stage2FlagCount,
        flagReasons,
      },
    })
  }

  return {
    corrections,
    totalRowsChecked: allRows.length,
    totalConsolidatedAccountsRows: allRows.filter((r) => r.consolidatedAccounts).length,
  }
}

export function printFixConsolidatedInvariantPlanReport(plan: FixConsolidatedInvariantPlan) {
  console.log(`Rows checked: ${plan.totalRowsChecked}`)
  console.log(`Rows with consolidatedAccounts = true: ${plan.totalConsolidatedAccountsRows}`)

  console.log(`\n=== Consolidated invariant violations found: ${plan.corrections.length} ===`)
  for (const c of plan.corrections) {
    console.log(`  ${c.id} (${c.country}):`)
    console.log(`    before: accounts=${c.before.consolidatedAccounts} profitNeg=${c.before.latestConsolidatedProfitNegative} assetsMoved=${c.before.consolidatedAssetsMovedSignificant} stage2Count=${c.before.stage2FlagCount} reasons="${c.before.flagReasons}"`)
    console.log(`    after:  accounts=${c.after.consolidatedAccounts} profitNeg=${c.after.latestConsolidatedProfitNegative} assetsMoved=${c.after.consolidatedAssetsMovedSignificant} stage2Count=${c.after.stage2FlagCount} reasons="${c.after.flagReasons}"`)
  }
}

// The only place any UPDATE happens. Touches the three consolidated booleans
// (consolidatedAccounts included, since rule (b) above can correct it too) plus
// stage2FlagCount/flagReasons, on exactly the rows in plan.corrections -- never routing
// (the routing checker, scripts/lib/fixRoutingPlan.ts, is a separate pass).
export async function applyFixConsolidatedInvariantPlan(db: Client, plan: FixConsolidatedInvariantPlan) {
  for (const c of plan.corrections) {
    await db.execute({
      sql: `UPDATE policies SET
        consolidatedAccounts = ?, latestConsolidatedProfitNegative = ?, consolidatedAssetsMovedSignificant = ?,
        stage2FlagCount = ?, flagReasons = ?
      WHERE id = ?`,
      args: [
        c.after.consolidatedAccounts, c.after.latestConsolidatedProfitNegative, c.after.consolidatedAssetsMovedSignificant,
        c.after.stage2FlagCount, c.after.flagReasons,
        c.id,
      ],
    })
  }
}
