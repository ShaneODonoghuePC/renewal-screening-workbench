// Dry run for the consolidated-accounts invariant fix (scripts/lib/fixConsolidatedInvariantPlan.ts)
// against the PRODUCTION Turso database.
//
// READ-ONLY BY CONSTRUCTION: only imports computeFixConsolidatedInvariantPlan, which only
// ever issues a SELECT. Does not import applyFixConsolidatedInvariantPlan, so there is no
// code path in this file that can write to the database. If you need to apply this to
// Turso, that's apply-fix-consolidated-invariant-turso.ts, a separate, deliberate file.
//
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.local, same as the app does.
//
// Run with: npx tsx scripts/dry-run-fix-consolidated-invariant-turso.ts

import { createClient } from '@libsql/client'
import { readFileSync } from 'fs'
import path from 'path'
import { computeFixConsolidatedInvariantPlan, printFixConsolidatedInvariantPlanReport } from './lib/fixConsolidatedInvariantPlan'

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
  console.log(`READ-ONLY dry run against Turso: ${DB_URL}\n`)

  const plan = await computeFixConsolidatedInvariantPlan(db)
  printFixConsolidatedInvariantPlanReport(plan)

  console.log('\nThis was a read-only dry run. No changes were made.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
