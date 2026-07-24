// Applies the routing correction (scripts/lib/fixRoutingPlan.ts) to the PRODUCTION
// Turso database. Only ever run this after dry-run-fix-routing-turso.ts has been run and
// its output reviewed -- this script performs the actual UPDATEs.
//
// Only touches policies.routing, only on rows identified as synthesized and violating
// the routing rule (see fixRoutingPlan.ts for the exact detection). Never touches any
// original policy, and never touches review_states/activity_log/comments.
//
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.local, same as the app does.
//
// Run with: npx tsx scripts/apply-fix-routing-turso.ts

import { createClient } from '@libsql/client'
import { readFileSync } from 'fs'
import path from 'path'
import { computeFixRoutingPlan, printFixRoutingPlanReport, applyFixRoutingPlan } from './lib/fixRoutingPlan'

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
  console.log(`APPLYING routing correction against Turso: ${DB_URL}\n`)

  const plan = await computeFixRoutingPlan(db)
  printFixRoutingPlanReport(plan)

  console.log('\nApplying...')
  await applyFixRoutingPlan(db, plan)
  console.log(`\nDone. ${plan.corrections.length} policies.routing values corrected.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
