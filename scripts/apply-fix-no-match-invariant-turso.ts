// Applies the D&B No Match invariant fix (scripts/lib/fixNoMatchInvariantPlan.ts) to the
// PRODUCTION Turso database. Only ever run this after
// dry-run-fix-no-match-invariant-turso.ts has been run and its output reviewed -- this
// script performs the actual UPDATEs.
//
// Only touches the ten fields named in the invariant plus stage2FlagCount/attention/
// flagReasons, only on rows that violate it. Never touches routing (see fix-routing.ts /
// SPEC.md S8.1 for that separate pass) or review_states/activity_log/comments.
//
// Production has no reseed path (SPEC.md S8.1), so this snapshots the full policies
// table to a committed JSON file BEFORE writing anything -- same discipline as
// apply-fix-currency-turso.ts / apply-fix-routing-turso.ts.
//
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.local, same as the app does.
//
// Run with: npx tsx scripts/apply-fix-no-match-invariant-turso.ts

import { createClient } from '@libsql/client'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { computeFixNoMatchInvariantPlan, printFixNoMatchInvariantPlanReport, applyFixNoMatchInvariantPlan } from './lib/fixNoMatchInvariantPlan'

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
  const filePath = path.join(dir, `policies-pre-no-match-invariant-fix-${stamp}.json`)
  writeFileSync(filePath, JSON.stringify(result.rows, null, 2))
  return filePath
}

async function main() {
  console.log(`APPLYING D&B No Match invariant fix against Turso: ${DB_URL}\n`)

  console.log('Snapshotting policies table before making any change...')
  const snapshotPath = await snapshotPolicies()
  console.log(`Snapshot written to ${snapshotPath}\n`)

  const plan = await computeFixNoMatchInvariantPlan(db)
  printFixNoMatchInvariantPlanReport(plan)

  console.log('\nApplying...')
  await applyFixNoMatchInvariantPlan(db, plan)
  console.log(`\nDone. ${plan.corrections.length} policies corrected.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
