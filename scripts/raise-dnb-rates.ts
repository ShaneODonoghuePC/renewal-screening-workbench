// Raises D&B No Match to ~10% of policies and D&B Status Inactive to ~3% of MATCHED
// policies (scripts/lib/raiseDnbRatesPlan.ts), deterministically and spread across
// countries. Never puts Status Inactive on a row also selected for No Match -- see that
// module's header comment for the selection order and why.
//
// This does NOT correct routing. Turning on a flag on a previously flag-free row changes
// whether "any flag fired" for the routing rule -- run scripts/fix-routing.ts (dry run,
// then --apply) AFTER this script, to correct any resulting routing violations.
//
// Hardcoded to file:./local.db, same convention as fix-routing.ts/fix-currency.ts.
//
// Run with: npx tsx scripts/raise-dnb-rates.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and writes nothing.

import { createClient } from '@libsql/client'
import { computeRaiseDnbRatesPlan, printRaiseDnbRatesPlanReport, applyRaiseDnbRatesPlan } from './lib/raiseDnbRatesPlan'

const DB_URL = 'file:./local.db'
const APPLY = process.argv.includes('--apply')

const db = createClient({ url: DB_URL })

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no changes will be made)'}`)
  console.log(`Database: ${DB_URL}\n`)

  const plan = await computeRaiseDnbRatesPlan(db)
  printRaiseDnbRatesPlanReport(plan)

  if (!APPLY) {
    console.log('\nDry run only -- no changes written. Re-run with --apply to write to local.db.')
    return
  }

  console.log('\nApplying...')
  await applyRaiseDnbRatesPlan(db, plan)
  console.log(`\nDone. ${plan.flips.length} policies updated. Now run scripts/fix-routing.ts to correct any resulting routing violations.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
