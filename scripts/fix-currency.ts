// Corrects policies.currency to match each policy's country (DK -> DKK, NO -> NOK,
// SE -> SEK, FI -> EUR) against local.db. Relabels currency only -- premium amounts
// are never touched.
//
// Hardcoded to file:./local.db, same convention as fix-routing.ts and
// migrate-status-workflow.ts. See dry-run-fix-currency-turso.ts /
// apply-fix-currency-turso.ts for the separate, dedicated Turso scripts.
//
// Run with: npx tsx scripts/fix-currency.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and writes nothing.

import { createClient } from '@libsql/client'
import { computeFixCurrencyPlan, printFixCurrencyPlanReport, applyFixCurrencyPlan } from './lib/fixCurrencyPlan'

const DB_URL = 'file:./local.db'
const APPLY = process.argv.includes('--apply')

const db = createClient({ url: DB_URL })

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no changes will be made)'}`)
  console.log(`Database: ${DB_URL}\n`)

  const plan = await computeFixCurrencyPlan(db)
  printFixCurrencyPlanReport(plan)

  if (!APPLY) {
    console.log('\nDry run only -- no changes written. Re-run with --apply to write to local.db.')
    return
  }

  console.log('\nApplying...')
  await applyFixCurrencyPlan(db, plan)
  console.log(`\nDone. ${plan.corrections.length} policies.currency values corrected.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
