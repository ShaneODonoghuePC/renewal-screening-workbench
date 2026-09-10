// Sets the initial incidence of the consolidated-accounts trio (scripts/lib/raiseConsolidatedRatesPlan.ts)
// in the committed seed files (data/seed/all.json plus the per-country dk/no/se/fi.json).
// Independent of the local.db/Turso run (a different, smaller 337-row row set, SPEC.md
// S8.1) but uses the same deterministic algorithm, so it lands near the same rates.
//
// Also corrects any resulting routing violations in the same pass (the two dependent
// flags are new routing triggers) -- same inline pattern as raise-dnb-rates-seed.ts.
//
// data/seed/init.sql is generated FROM all.json (scripts/generate-sql-dump.ts), so this
// does not hand-edit init.sql directly -- run `npm run seed-db` afterwards.
//
// Run with: npx tsx scripts/raise-consolidated-rates-seed.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and writes nothing.

import fs from 'fs'
import path from 'path'
import { computeRaiseConsolidatedRatesPlanForRows, printRaiseConsolidatedRatesPlanReport } from './lib/raiseConsolidatedRatesPlan'
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
    const rawRows = loadJson(file)
    // Backfill the new columns on EVERY row first (not just the ones this run selects) --
    // the seed files predate consolidatedAccounts/latestConsolidatedProfitNegative/
    // consolidatedAssetsMovedSignificant/businessLine entirely, so without this every row
    // would be missing these keys rather than explicitly carrying their default values.
    const rows = rawRows.map((row: any) => ({
      ...row,
      consolidatedAccounts: row.consolidatedAccounts ?? false,
      latestConsolidatedProfitNegative: row.latestConsolidatedProfitNegative ?? false,
      consolidatedAssetsMovedSignificant: row.consolidatedAssetsMovedSignificant ?? false,
      businessLine: row.businessLine ?? 'D&O',
    }))

    console.log(`=== ${file}: consolidated-accounts rate raise ===`)
    const ratePlan = computeRaiseConsolidatedRatesPlanForRows(rows)
    printRaiseConsolidatedRatesPlanReport(ratePlan)
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
