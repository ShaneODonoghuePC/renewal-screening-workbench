// Applies the D&B rate raise (scripts/lib/raiseDnbRatesPlan.ts) to the PRODUCTION Turso
// database: D&B No Match to ~10% of policies, D&B Status Inactive to ~3% of matched
// policies. Only ever run this after dry-run-raise-dnb-rates-turso.ts has been run and
// its output reviewed -- this script performs the actual UPDATEs.
//
// Does NOT correct routing -- run scripts/dry-run-fix-routing-turso.ts then
// scripts/apply-fix-routing-turso.ts AFTER this script, to correct any routing
// violations this rate raise creates (turning on a flag on a previously flag-free row
// changes whether "any flag fired" for that row's routing rule). See SPEC.md S8.3.
//
// Production has no reseed path (SPEC.md S8.1), so this snapshots the full policies
// table to a committed JSON file BEFORE writing anything -- same discipline as
// apply-fix-currency-turso.ts / apply-fix-no-match-invariant-turso.ts.
//
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.local, same as the app does.
//
// Run with: npx tsx scripts/apply-raise-dnb-rates-turso.ts

import { createClient } from '@libsql/client'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { computeRaiseDnbRatesPlan, printRaiseDnbRatesPlanReport, applyRaiseDnbRatesPlan } from './lib/raiseDnbRatesPlan'

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

async function snapshotPolicies(): Promise<string> {
  const result = await db.execute('SELECT * FROM policies')
  const dir = path.resolve(process.cwd(), 'data', 'snapshots')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `policies-pre-raise-dnb-rates-${stamp}.json`)
  writeFileSync(filePath, JSON.stringify(result.rows, null, 2))
  return filePath
}

async function main() {
  console.log(`APPLYING D&B rate raise against Turso: ${DB_URL}\n`)

  console.log('Snapshotting policies table before making any change...')
  const snapshotPath = await snapshotPolicies()
  console.log(`Snapshot written to ${snapshotPath}\n`)

  const plan = await computeRaiseDnbRatesPlan(db)
  printRaiseDnbRatesPlanReport(plan)

  console.log('\nApplying...')
  await applyRaiseDnbRatesPlan(db, plan)
  console.log(`\nDone. ${plan.flips.length} policies updated. Now run dry-run-fix-routing-turso.ts / apply-fix-routing-turso.ts to correct any resulting routing violations.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
