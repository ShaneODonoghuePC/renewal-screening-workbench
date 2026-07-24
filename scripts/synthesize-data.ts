// Two additive data-quality fixes for the synthesized dataset:
//
//   1. Uneven policy counts -- every country currently has exactly the same number of
//      policies in every renewal month, which doesn't look like real renewal volume.
//      Adds a random (but deterministic, see lib/synthesizePlan.ts) number of extra
//      policies per country per existing calendar month, spread across all three
//      routings. Purely additive: existing policies.id/review_states/activity_log/
//      comments rows are never touched, renamed, or regenerated -- this only INSERTs
//      new policies rows (plus a fresh review_states row per new Manual Review/Navins
//      Renew policy, starting "Not Started"; RPUX Auto Renew never gets a
//      review_states row, same as every existing Auto Renew policy). New IDs continue
//      the existing RPX-{country}-{NNNNN} numbering per country from its current max,
//      which is the dominant/systematic scheme already in use for Manual Review + RPUX
//      Auto Renew in every country (the "{country}-10.101-{NNNNN}/25/01" pattern
//      present on a subset of existing Manual Review/Navins Renew rows looks like an
//      independently-curated numbering and isn't extended here).
//
//   2. Realistic VAT numbers -- customerIdentifier (displayed as "VAT Number") is
//      currently placeholder-looking ("ORG-XXXX"). Regenerated to match each
//      country's real VAT number *structure* (still fully synthetic digits, not real
//      numbers): DK########  (8 digits), FI######## (8 digits), NO#########MVA
//      (9 digits), SE##########01 (10 digits). Generated once per distinct
//      (country, customerName) pair and applied to every policy sharing that pair --
//      several companies already appear on multiple policies in this dataset, and a
//      real VAT number represents the company, not the renewal cycle, so they must
//      all end up with the identical value. This also covers the brand-new policies
//      from fix #1: if a new policy reuses an existing company name (as most do --
//      see lib/synthesizePlan.ts), it gets that company's existing VAT rather than a
//      fresh one.
//
// Hardcoded to file:./local.db, same convention as migrate-status-workflow.ts -- this
// must never import lib/db/client.ts or read TURSO_* env vars, so it can't accidentally
// point at production. See dry-run-synthesize-turso.ts / apply-synthesize-turso.ts for
// the separate, dedicated Turso scripts (read-only dry run, then a deliberate apply),
// following the same three-script discipline as the earlier status-workflow migration.
// All three share the actual plan-computation algorithm from scripts/lib/synthesizePlan.ts
// rather than each reimplementing it, so the dry run and the apply can never silently
// compute two different plans.
//
// Run with: npx tsx scripts/synthesize-data.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and writes nothing.

import { createClient } from '@libsql/client'
import { computeSynthesizePlan, printPlanReport, applySynthesizePlan } from './lib/synthesizePlan'

const DB_URL = 'file:./local.db'
const APPLY = process.argv.includes('--apply')

const db = createClient({ url: DB_URL })

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no changes will be made)'}`)
  console.log(`Database: ${DB_URL}\n`)

  const plan = await computeSynthesizePlan(db)
  printPlanReport(plan)

  if (!APPLY) {
    console.log('\nDry run only -- no changes written. Re-run with --apply to write to local.db.')
    return
  }

  console.log('\nApplying...')
  await applySynthesizePlan(db, plan)
  console.log(`\nDone. ${plan.newPolicies.length} new policies inserted, ${plan.newPolicies.filter((r) => r.routing !== 'RPUX Auto Renew').length} new review_states rows inserted, ${plan.vatUpdates.length} existing customerIdentifier values updated.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
