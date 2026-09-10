// Shared plan-computation logic for correcting routing on policies that violate the
// dataset's actual routing rule: routing is fully determined by source system (RPUX,
// identifiable from an RPX-{country}-{NNNNN} id, vs. Navins, identifiable from a
// {country}-10.101-{NNNNN}/25/01 id) plus whether any flag fired -- RPUX clean -> RPUX
// Auto Renew, RPUX flagged -> Manual Review; Navins clean -> NAVINS Renew, Navins flagged
// -> Manual Review. Confirmed against all 337 original policies with zero exceptions.
//
// lib/synthesizePlan.ts's generator originally sampled routing independently of both
// source system and flags, so some of the policies it added violated this rule -- first
// a batch of 10 (any-flag-fired rows marked RPUX Auto Renew or flag-free rows marked
// Manual Review/NAVINS Renew, e.g. RPX-DK-10137), later found to be an incomplete fix:
// 3 more rows had an RPX id and a flag fired but were left on NAVINS Renew, which the
// original version of this rule (checking only "any non-Auto-Renew routing has >=1 flag")
// didn't catch, since NAVINS Renew with a flag looked fine under that narrower check --
// and that narrower check also misfired the other way, wrongly flagging 18 perfectly
// legitimate flag-free NAVINS Renew rows in the ORIGINAL data as violations, purely
// because it never considered source system at all. The generator bug is now fixed
// (source system is decided first, id and routing both follow from it); this module
// finds and corrects the already-inserted rows that still violate the corrected rule.
//
// Because the rule now accounts for source system, it holds with zero exceptions across
// the original 337 policies (confirmed directly), so anything it flags is guaranteed to
// be a synthesized row -- there is no longer any need to separately detect "is this row
// synthesized" the way an earlier version of this module did. computeFixRoutingPlan()
// only ever issues a SELECT against policies (read-only); applyFixRoutingPlan() is the
// only place any UPDATE happens, and it only ever updates the `routing` column -- never
// review_states, activity_log, or comments.
//
// Business line (2026-09-11, SPEC.md S3.1): checked BEFORE source system + flags --
// a business line in MANUAL_REVIEW_FORCED_BUSINESS_LINES forces Manual Review on its
// own, full stop. D&O (the only business line modelled here) is never in that set, so
// this is scaffolding, not a behaviour change -- see scripts/lib/businessLine.ts.
//
// The two consolidated scoring flags (SPEC.md S3.3, added 2026-09-11) are in FLAG_KEYS
// below like any other Stage 2 flag -- consolidatedAccounts itself is deliberately NOT,
// since it's pure context and does not contribute to routing.

import type { Client } from '@libsql/client'
import { businessLineForcesManualReview } from './businessLine'

const FLAG_KEYS = [
  'openClaim', 'premiumUnpaid', 'renewalTypeManual', 'systemListedCompany',
  'dnbNoMatch', 'dnbStatusInactive', 'dnbRatingBelowA', 'latestProfitNegative',
  'assetsMovedSignificant', 'dnbListedCompany',
  'latestConsolidatedProfitNegative', 'consolidatedAssetsMovedSignificant',
] as const

type PolicyRow = {
  id: string
  country: string
  routing: string | null
  businessLine: string | null
} & Record<(typeof FLAG_KEYS)[number], boolean>

function isRpxId(id: string): boolean {
  return /^RPX-[A-Z]{2}-\d+$/.test(id)
}

function isNavinsId(id: string): boolean {
  return /^[A-Z]{2}-10\.101-\d+\/25\/01$/.test(id)
}

function anyFlagFired(row: PolicyRow): boolean {
  return FLAG_KEYS.some((key) => row[key])
}

// The routing a policy's business line, id scheme, and flags dictate. Null for a row
// whose id matches neither known scheme -- nothing in this dataset should hit that, but
// it's reported rather than silently skipped or guessed at.
function expectedRouting(row: PolicyRow): string | null {
  if (businessLineForcesManualReview(row.businessLine)) return 'Manual Review'
  const anyFlag = anyFlagFired(row)
  if (isRpxId(row.id)) return anyFlag ? 'Manual Review' : 'RPUX Auto Renew'
  if (isNavinsId(row.id)) return anyFlag ? 'Manual Review' : 'NAVINS Renew'
  return null
}

export type RoutingCorrection = {
  id: string
  country: string
  from: string
  to: string
}

export type UnrecognizedIdScheme = {
  id: string
  country: string
  routing: string | null
}

export type FixRoutingPlan = {
  corrections: RoutingCorrection[]
  unrecognizedIdSchemes: UnrecognizedIdScheme[]
  totalRowsChecked: number
}

function planFromRows(allRows: PolicyRow[]): FixRoutingPlan {
  const corrections: RoutingCorrection[] = []
  const unrecognizedIdSchemes: UnrecognizedIdScheme[] = []

  for (const row of allRows) {
    const expected = expectedRouting(row)
    if (expected === null) {
      unrecognizedIdSchemes.push({ id: row.id, country: row.country, routing: row.routing })
      continue
    }
    if (row.routing !== expected) {
      corrections.push({ id: row.id, country: row.country, from: row.routing ?? '(null)', to: expected })
    }
  }

  return { corrections, unrecognizedIdSchemes, totalRowsChecked: allRows.length }
}

// Read-only: SELECT-only against policies, then pure computation. No INSERT/UPDATE
// anywhere in this function or anything it calls.
export async function computeFixRoutingPlan(db: Client): Promise<FixRoutingPlan> {
  const policiesResult = await db.execute('SELECT * FROM policies')
  return planFromRows(policiesResult.rows as unknown as PolicyRow[])
}

// Same plan computation, over an in-memory array -- for data/seed/*.json, which has no
// database to SELECT from (mirrors fixCurrencyPlan.ts's ForRows variant).
export function computeFixRoutingPlanForRows(rows: PolicyRow[]): FixRoutingPlan {
  return planFromRows(rows)
}

export function printFixRoutingPlanReport(plan: FixRoutingPlan) {
  console.log(`Rows checked: ${plan.totalRowsChecked}`)

  console.log(`\n=== Routing violations found (source system + flags rule): ${plan.corrections.length} ===`)
  for (const c of plan.corrections) {
    console.log(`  ${c.id} (${c.country}): ${c.from} -> ${c.to}`)
  }

  if (plan.unrecognizedIdSchemes.length > 0) {
    console.log(`\n=== Rows with an id matching neither known scheme -- NOT evaluated: ${plan.unrecognizedIdSchemes.length} ===`)
    for (const u of plan.unrecognizedIdSchemes) {
      console.log(`  ${u.id} (${u.country}): routing=${u.routing}`)
    }
  }
}

// The only place any UPDATE happens. Touches policies.routing only, on exactly the rows
// in plan.corrections -- never review_states, activity_log, or comments.
export async function applyFixRoutingPlan(db: Client, plan: FixRoutingPlan) {
  for (const c of plan.corrections) {
    await db.execute({ sql: 'UPDATE policies SET routing = ? WHERE id = ?', args: [c.to, c.id] })
  }
}
