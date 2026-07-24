// Synthesized-data fixes -- PRODUCTION APPLY, run once against Turso.
//
// This is a dedicated, minimal apply step, deliberately separate from
// synthesize-data.ts (hardcoded to local.db) and dry-run-synthesize-turso.ts
// (read-only by construction). It exists only because applying to Turso was explicitly
// authorized after reviewing dry-run-synthesize-turso.ts's output against production's
// actual data. Both fixes are additive/non-destructive by construction (see the top of
// synthesize-data.ts for the full rationale), but this file is still not meant to be
// reusable or casually re-run: running it twice would add a second, independent round
// of extra policies on top of the first (harmless but redundant) and would no-op on the
// VAT numbers (already-correct values just get reassigned the same value).
//
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.local. Prints the full plan
// before writing anything, then applies it, matching apply-migration-turso.ts's pattern.
//
// Run with: npx tsx scripts/apply-synthesize-turso.ts

import { createClient } from '@libsql/client'
import { readFileSync } from 'fs'
import path from 'path'
import { computeSynthesizePlan, printPlanReport, applySynthesizePlan } from './lib/synthesizePlan'

function loadEnvLocal() {
  const filePath = path.resolve(process.cwd(), '.env.local')
  const content = readFileSync(filePath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvLocal()

const DB_URL = process.env.TURSO_DATABASE_URL
const AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN

if (!DB_URL || !AUTH_TOKEN) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in .env.local -- aborting.')
  process.exit(1)
}

const db = createClient({ url: DB_URL, authToken: AUTH_TOKEN })

async function main() {
  console.log(`Target: ${DB_URL}\n`)

  const plan = await computeSynthesizePlan(db)
  printPlanReport(plan)

  console.log('\nApplying...')
  await applySynthesizePlan(db, plan)
  console.log(`\nDone. ${plan.newPolicies.length} new policies inserted, ${plan.newPolicies.filter((r) => r.routing !== 'RPUX Auto Renew').length} new review_states rows inserted, ${plan.vatUpdates.length} existing customerIdentifier values updated.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
