// Sets the initial incidence of the consolidated-accounts trio (scripts/lib/raiseConsolidatedRatesPlan.ts):
// Consolidated Accounts ~18% of policies; Latest Consolidated Profit Negative ~40% and
// Consolidated Assets Moved >25% YoY ~15%, both of the consolidated pool, drawn
// independently. Deterministic, stratified per country.
//
// This does NOT correct routing. The two dependent flags are new routing triggers -- run
// scripts/fix-routing.ts (dry run, then --apply) AFTER this script.
//
// Hardcoded to file:./local.db, same convention as raise-dnb-rates.ts.
//
// Run with: npx tsx scripts/raise-consolidated-rates.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and writes nothing.

import { createClient } from '@libsql/client'
import { computeRaiseConsolidatedRatesPlan, printRaiseConsolidatedRatesPlanReport, applyRaiseConsolidatedRatesPlan } from './lib/raiseConsolidatedRatesPlan'

const DB_URL = 'file:./local.db'
const APPLY = process.argv.includes('--apply')

const db = createClient({ url: DB_URL })

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no changes will be made)'}`)
  console.log(`Database: ${DB_URL}\n`)

  const plan = await computeRaiseConsolidatedRatesPlan(db)
  printRaiseConsolidatedRatesPlanReport(plan)

  if (!APPLY) {
    console.log('\nDry run only -- no changes written. Re-run with --apply to write to local.db.')
    return
  }

  console.log('\nApplying...')
  await applyRaiseConsolidatedRatesPlan(db, plan)
  console.log(`\nDone. ${plan.flips.length} policies updated. Now run scripts/fix-routing.ts to correct any resulting routing violations.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
