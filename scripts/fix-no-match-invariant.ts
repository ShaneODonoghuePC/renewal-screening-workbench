// Corrects already-inserted policies that violate the D&B No Match invariant (SPEC.md
// S3.3/S7.1, added 2026-09-10): when dnbNoMatch is true, the other five Stage 2 flags
// must be false and their five supporting figures must be null. RPX-DK-10079 is the
// live example this was written against -- dnbNoMatch=true alongside dnbRating="AA2"
// and dnbOperatingStatusLabel="Active", which cannot both be true.
//
// Hardcoded to file:./local.db, same convention as fix-routing.ts/fix-currency.ts. See
// dry-run-fix-no-match-invariant-turso.ts / apply-fix-no-match-invariant-turso.ts for the
// separate, dedicated Turso scripts (read-only dry run, then a deliberate apply).
//
// Run with: npx tsx scripts/fix-no-match-invariant.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and writes nothing.

import { createClient } from '@libsql/client'
import { computeFixNoMatchInvariantPlan, printFixNoMatchInvariantPlanReport, applyFixNoMatchInvariantPlan } from './lib/fixNoMatchInvariantPlan'

const DB_URL = 'file:./local.db'
const APPLY = process.argv.includes('--apply')

const db = createClient({ url: DB_URL })

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no changes will be made)'}`)
  console.log(`Database: ${DB_URL}\n`)

  const plan = await computeFixNoMatchInvariantPlan(db)
  printFixNoMatchInvariantPlanReport(plan)

  if (!APPLY) {
    console.log('\nDry run only -- no changes written. Re-run with --apply to write to local.db.')
    return
  }

  console.log('\nApplying...')
  await applyFixNoMatchInvariantPlan(db, plan)
  console.log(`\nDone. ${plan.corrections.length} policies corrected.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
