// Corrects routing on already-inserted policies that violate the dataset's actual
// routing rule: routing is determined by source system (RPUX vs. Navins, from the id
// scheme) plus whether any flag fired -- RPUX clean -> RPUX Auto Renew, RPUX flagged ->
// Manual Review; Navins clean -> NAVINS Renew, Navins flagged -> Manual Review. A bug in
// the original synthesis generator (see scripts/lib/synthesizePlan.ts, now fixed for new
// rows going forward) left a handful of already-inserted rows contradicting this rule --
// e.g. RPX-DK-10137 landed on Manual Review with zero flags fired, and separately,
// RPX-NO-10136/RPX-NO-10137/RPX-SE-10096 landed on NAVINS Renew despite having an RPX id
// and a flag fired.
//
// The rule holds with zero exceptions across the original 337 policies (confirmed
// directly), so anything scripts/lib/fixRoutingPlan.ts finds is guaranteed to be a
// synthesized row -- no separate "is this synthesized" check is needed. This never
// touches review_states/activity_log/comments; the only write is an UPDATE of
// policies.routing on the rows found to violate the rule.
//
// Hardcoded to file:./local.db, same convention as migrate-status-workflow.ts and
// synthesize-data.ts. See dry-run-fix-routing-turso.ts / apply-fix-routing-turso.ts for
// the separate, dedicated Turso scripts (read-only dry run, then a deliberate apply).
//
// Run with: npx tsx scripts/fix-routing.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and writes nothing.

import { createClient } from '@libsql/client'
import { computeFixRoutingPlan, printFixRoutingPlanReport, applyFixRoutingPlan } from './lib/fixRoutingPlan'

const DB_URL = 'file:./local.db'
const APPLY = process.argv.includes('--apply')

const db = createClient({ url: DB_URL })

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no changes will be made)'}`)
  console.log(`Database: ${DB_URL}\n`)

  const plan = await computeFixRoutingPlan(db)
  printFixRoutingPlanReport(plan)

  if (!APPLY) {
    console.log('\nDry run only -- no changes written. Re-run with --apply to write to local.db.')
    return
  }

  console.log('\nApplying...')
  await applyFixRoutingPlan(db, plan)
  console.log(`\nDone. ${plan.corrections.length} policies.routing values corrected.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
