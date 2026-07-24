// Corrects routing on already-inserted synthesized policies that violate the dataset's
// actual routing rule (zero flags fired -> RPUX Auto Renew; any flag fired -> Manual
// Review/NAVINS Renew), a bug in the original synthesis generator (see
// scripts/lib/synthesizePlan.ts, which is now fixed for new rows going forward) that
// left a handful of already-inserted rows contradicting the rule -- e.g. RPX-DK-10137
// landed on Manual Review with zero flags fired.
//
// Scoped to synthesized rows only, identified structurally (see
// scripts/lib/fixRoutingPlan.ts for the exact signature) -- this never touches any of
// the dataset's original policies, even if one of them happens to trip the same check,
// and never touches review_states/activity_log/comments; the only write is an UPDATE of
// policies.routing on the synthesized rows found to be wrong.
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
