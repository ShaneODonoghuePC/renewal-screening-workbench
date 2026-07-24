// Dry run for the two synthesized-data fixes (uneven policy counts per country/month,
// realistic per-company VAT numbers) against the PRODUCTION Turso database.
//
// This script is READ-ONLY BY CONSTRUCTION: it only imports computeSynthesizePlan from
// scripts/lib/synthesizePlan.ts, which only ever issues SELECT queries. It does not
// import applySynthesizePlan (the only function in that module that writes), so there
// is no code path in this file that can write to the database -- same property
// dry-run-migration-turso.ts has. If you need to apply this to Turso, that's
// apply-synthesize-turso.ts, a separate, deliberate file.
//
// Local.db's own shape does not necessarily match production's -- run this and read its
// output rather than assuming the earlier local.db dry run generalizes.
//
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.local, same as the app does.
//
// Run with: npx tsx scripts/dry-run-synthesize-turso.ts

import { createClient } from '@libsql/client'
import { readFileSync } from 'fs'
import path from 'path'
import { computeSynthesizePlan, printPlanReport } from './lib/synthesizePlan'

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

  const plan = await computeSynthesizePlan(db)
  printPlanReport(plan)

  console.log('\nThis was a read-only dry run. No changes were made.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
