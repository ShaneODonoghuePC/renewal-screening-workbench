// Applies the consolidated-accounts trio's initial incidence (scripts/lib/raiseConsolidatedRatesPlan.ts)
// to the PRODUCTION Turso database. Only ever run this after
// dry-run-raise-consolidated-rates-turso.ts has been run and its output reviewed.
//
// Does NOT correct routing -- run scripts/dry-run-fix-routing-turso.ts then
// scripts/apply-fix-routing-turso.ts AFTER this script.
//
// Production has no reseed path (SPEC.md S8.1), so this snapshots the full policies
// table to a committed JSON file BEFORE writing anything.
//
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.local, same as the app does.
//
// Run with: npx tsx scripts/apply-raise-consolidated-rates-turso.ts

import { createClient } from '@libsql/client'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { computeRaiseConsolidatedRatesPlan, printRaiseConsolidatedRatesPlanReport, applyRaiseConsolidatedRatesPlan } from './lib/raiseConsolidatedRatesPlan'

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
  const filePath = path.join(dir, `policies-pre-raise-consolidated-rates-${stamp}.json`)
  writeFileSync(filePath, JSON.stringify(result.rows, null, 2))
  return filePath
}

async function main() {
  console.log(`APPLYING consolidated-accounts rate raise against Turso: ${DB_URL}\n`)

  console.log('Snapshotting policies table before making any change...')
  const snapshotPath = await snapshotPolicies()
  console.log(`Snapshot written to ${snapshotPath}\n`)

  const plan = await computeRaiseConsolidatedRatesPlan(db)
  printRaiseConsolidatedRatesPlanReport(plan)

  console.log('\nApplying...')
  await applyRaiseConsolidatedRatesPlan(db, plan)
  console.log(`\nDone. ${plan.flips.length} policies updated. Now run dry-run-fix-routing-turso.ts / apply-fix-routing-turso.ts to correct any resulting routing violations.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
