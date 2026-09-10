// Shared plan-computation logic for correcting existing policies that violate the
// consolidated-accounts invariant (SPEC.md S3.3/S7.1, added 2026-09-11): the two
// dependent flags (latestConsolidatedProfitNegative, consolidatedAssetsMovedSignificant)
// can only be true where consolidatedAccounts is true -- the real engine leaves them
// BLANK (could not assess) when no consolidated accounts exist; this prototype does not
// model blanks, so they collapse to false there instead. See scripts/lib/dnbRules.ts.
//
// Same shape as scripts/lib/fixNoMatchInvariantPlan.ts: computeFixConsolidatedInvariantPlan()
// only ever issues a SELECT against policies (read-only); applyFixConsolidatedInvariantPlan()
// is the only place any UPDATE happens. The generator (scripts/lib/synthesizePlan.ts) and
// the rate-raising plan (scripts/lib/raiseConsolidatedRatesPlan.ts) both enforce this
// invariant at the point they draw these booleans, so neither can produce a violating row
// -- this module exists as the same read-only-checker-plus-apply-step safety net the No
// Match invariant has, even though it is expected to find zero violations in practice.

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
    if (row.consolidatedAccounts) continue
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
    console.log(`    before: profitNeg=${c.before.latestConsolidatedProfitNegative} assetsMoved=${c.before.consolidatedAssetsMovedSignificant} stage2Count=${c.before.stage2FlagCount} reasons="${c.before.flagReasons}"`)
    console.log(`    after:  profitNeg=${c.after.latestConsolidatedProfitNegative} assetsMoved=${c.after.consolidatedAssetsMovedSignificant} stage2Count=${c.after.stage2FlagCount} reasons="${c.after.flagReasons}"`)
  }
}

// The only place any UPDATE happens. Touches exactly the two dependent booleans plus
// stage2FlagCount/flagReasons, on exactly the rows in plan.corrections -- never
// consolidatedAccounts itself (never wrong by construction of this checker), never
// routing (the routing checker, scripts/lib/fixRoutingPlan.ts, is a separate pass).
export async function applyFixConsolidatedInvariantPlan(db: Client, plan: FixConsolidatedInvariantPlan) {
  for (const c of plan.corrections) {
    await db.execute({
      sql: `UPDATE policies SET
        latestConsolidatedProfitNegative = ?, consolidatedAssetsMovedSignificant = ?,
        stage2FlagCount = ?, flagReasons = ?
      WHERE id = ?`,
      args: [
        c.after.latestConsolidatedProfitNegative, c.after.consolidatedAssetsMovedSignificant,
        c.after.stage2FlagCount, c.after.flagReasons,
        c.id,
      ],
    })
  }
}
