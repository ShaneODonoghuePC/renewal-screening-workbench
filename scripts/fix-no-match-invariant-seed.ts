// Corrects the D&B No Match invariant (scripts/lib/fixNoMatchInvariantPlan.ts) in the
// committed seed files (data/seed/all.json plus the per-country dk/no/se/fi.json), using
// the same plan logic as fix-no-match-invariant.ts / the Turso variant.
//
// data/seed/init.sql is generated FROM all.json (scripts/generate-sql-dump.ts), so this
// does not hand-edit init.sql directly -- run `npm run seed-db` afterwards to regenerate
// it from the corrected all.json, same convention as fix-currency-seed.ts.
//
// Run with: npx tsx scripts/fix-no-match-invariant-seed.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and writes nothing.

import fs from 'fs'
import path from 'path'
import { computeFixNoMatchInvariantPlanForRows, printFixNoMatchInvariantPlanReport } from './lib/fixNoMatchInvariantPlan'

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
    const plan = computeFixNoMatchInvariantPlanForRows(rows)

    console.log(`=== ${file} ===`)
    printFixNoMatchInvariantPlanReport(plan)
    console.log()

    if (!APPLY || plan.corrections.length === 0) continue

    const byId = new Map(plan.corrections.map((c) => [c.id, c.after]))
    const updated = rows.map((row) => (byId.has(row.id) ? { ...row, ...byId.get(row.id) } : row))
    fs.writeFileSync(path.join(seedDir, file), JSON.stringify(updated, null, 2) + '\n')
    console.log(`Wrote ${plan.corrections.length} correction(s) to ${file}.`)
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
