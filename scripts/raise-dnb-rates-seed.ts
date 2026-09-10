// Raises D&B No Match to ~10% and D&B Status Inactive to ~3% of matched policies in the
// committed seed files (data/seed/all.json plus the per-country dk/no/se/fi.json), using
// the same plan logic as raise-dnb-rates.ts / the Turso variant
// (scripts/lib/raiseDnbRatesPlan.ts). Selection is independent of the local.db/Turso run
// (a different, smaller 337-row row set -- the seed files were never regenerated to
// include the synthesized rows, SPEC.md S8.1) but uses the same deterministic algorithm,
// so it lands near the same ~10%/~3% rates.
//
// Also corrects any resulting routing violations in the same pass (scripts/lib/fixRoutingPlan.ts's
// ForRows variant) -- turning on a flag on a previously flag-free row changes whether "any
// flag fired" for that row's routing rule, the same knock-on the DB-backed script handles
// with a separate fix-routing.ts run afterward; doing it inline here keeps the seed files
// internally consistent in one step.
//
// data/seed/init.sql is generated FROM all.json (scripts/generate-sql-dump.ts), so this
// does not hand-edit init.sql directly -- run `npm run seed-db` afterwards.
//
// Run with: npx tsx scripts/raise-dnb-rates-seed.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and writes nothing.

import fs from 'fs'
import path from 'path'
import { computeRaiseDnbRatesPlanForRows, printRaiseDnbRatesPlanReport } from './lib/raiseDnbRatesPlan'
import { computeFixRoutingPlanForRows, printFixRoutingPlanReport } from './lib/fixRoutingPlan'

const APPLY = process.argv.includes('--apply')
const seedDir = path.resolve(process.cwd(), 'data', 'seed')

const FILES = ['all.json', 'dk.json', 'no.json', 'se.json', 'fi.json']

function loadJson(file: string): any[] {
  return JSON.parse(fs.readFileSync(path.join(seedDir, file), 'utf8'))
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing seed files)' : 'DRY RUN (no files will be changed)'}\n`)

  for (const file of FILES) {
    const rows = loadJson(file)

    console.log(`=== ${file}: D&B rate raise ===`)
    const ratePlan = computeRaiseDnbRatesPlanForRows(rows)
    printRaiseDnbRatesPlanReport(ratePlan)
    console.log()

    const byId = new Map(ratePlan.flips.map((f) => [f.id, f.after]))
    const rowsAfterRates = rows.map((row) => (byId.has(row.id) ? { ...row, ...byId.get(row.id) } : row))

    console.log(`=== ${file}: routing check (after rate raise) ===`)
    const routingPlan = computeFixRoutingPlanForRows(rowsAfterRates)
    printFixRoutingPlanReport(routingPlan)
    console.log()

    if (!APPLY) continue

    const routingById = new Map(routingPlan.corrections.map((c) => [c.id, c.to]))
    const finalRows = rowsAfterRates.map((row) => (routingById.has(row.id) ? { ...row, routing: routingById.get(row.id) } : row))
    fs.writeFileSync(path.join(seedDir, file), JSON.stringify(finalRows, null, 2) + '\n')
    console.log(`Wrote ${ratePlan.flips.length} rate flip(s) and ${routingPlan.corrections.length} routing correction(s) to ${file}.`)
  }

  if (!APPLY) {
    console.log('Dry run only -- no files written. Re-run with --apply to write the seed files.')
    console.log('After applying, run `npm run seed-db` to regenerate data/seed/init.sql from the corrected all.json.')
    return
  }

  console.log('Done. Now run `npm run seed-db` to regenerate data/seed/init.sql from the corrected all.json.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
