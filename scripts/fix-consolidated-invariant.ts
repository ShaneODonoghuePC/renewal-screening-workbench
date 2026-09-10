// Corrects already-inserted policies that violate the consolidated-accounts invariant
// (SPEC.md S3.3/S7.1, added 2026-09-11): the two dependent flags can only be true where
// consolidatedAccounts is true.
//
// Hardcoded to file:./local.db, same convention as fix-no-match-invariant.ts. See
// dry-run-fix-consolidated-invariant-turso.ts / apply-fix-consolidated-invariant-turso.ts
// for the separate, dedicated Turso scripts.
//
// Run with: npx tsx scripts/fix-consolidated-invariant.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and writes nothing.

import { createClient } from '@libsql/client'
import { computeFixConsolidatedInvariantPlan, printFixConsolidatedInvariantPlanReport, applyFixConsolidatedInvariantPlan } from './lib/fixConsolidatedInvariantPlan'

const DB_URL = 'file:./local.db'
const APPLY = process.argv.includes('--apply')

const db = createClient({ url: DB_URL })

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no changes will be made)'}`)
  console.log(`Database: ${DB_URL}\n`)

  const plan = await computeFixConsolidatedInvariantPlan(db)
  printFixConsolidatedInvariantPlanReport(plan)

  if (!APPLY) {
    console.log('\nDry run only -- no changes written. Re-run with --apply to write to local.db.')
    return
  }

  console.log('\nApplying...')
  await applyFixConsolidatedInvariantPlan(db, plan)
  console.log(`\nDone. ${plan.corrections.length} policies corrected.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
