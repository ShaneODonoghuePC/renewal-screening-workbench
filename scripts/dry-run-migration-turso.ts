// Phase 2A migration dry run against the PRODUCTION Turso database.
//
// This script is READ-ONLY BY CONSTRUCTION: it only ever issues SELECT queries and
// contains no code path that can write to the database (unlike
// migrate-status-workflow.ts, which supports --apply against local.db). There is no
// flag that turns this into a write -- if you need to apply the migration to Turso,
// that requires a separate, deliberate change to this file or to
// migrate-status-workflow.ts, not a flag on this one.
//
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.local, same as the app does.
//
// Run with: npx tsx scripts/dry-run-migration-turso.ts

import { createClient } from '@libsql/client'
import { readFileSync } from 'fs'
import path from 'path'

// Minimal .env.local parser (avoids an extra dependency) -- same file the app reads its
// TURSO_* config from, just loaded manually since this is a standalone tsx script.
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

type Row = { policyId: string; status: string; routing: string; country: string }

async function activityHistory(policyId: string) {
  const result = await db.execute({
    sql: `SELECT eventType, userId, detail, createdAt FROM activity_log WHERE policyId = ? ORDER BY createdAt ASC`,
    args: [policyId],
  })
  return result.rows as unknown as Array<{ eventType: string; userId: string | null; detail: string | null; createdAt: string }>
}

function summarizeEntry(entry: { eventType: string; detail: string | null; createdAt: string }) {
  let detail: Record<string, unknown> = {}
  try {
    detail = entry.detail ? JSON.parse(entry.detail) : {}
  } catch {
    detail = {}
  }
  if (entry.eventType === 'status_change') {
    return `${entry.createdAt}  status_change  ${detail.from ?? '?'} -> ${detail.to ?? '?'}`
  }
  if (entry.eventType === 'assignment_change') {
    return `${entry.createdAt}  assignment_change  ${detail.from ?? 'Unassigned'} -> ${detail.to ?? 'Unassigned'}`
  }
  if (entry.eventType === 'comment_added') {
    return `${entry.createdAt}  comment_added`
  }
  return `${entry.createdAt}  ${entry.eventType}`
}

async function main() {
  console.log(`READ-ONLY dry run against Turso: ${DB_URL}\n`)

  const rowsResult = await db.execute(`
    SELECT rs.policyId as policyId, rs.status as status, p.routing as routing, p.country as country
    FROM review_states rs
    JOIN policies p ON p.id = rs.policyId
  `)
  const rows = rowsResult.rows as unknown as Row[]

  const manualRows = rows.filter((r) => r.routing === 'Manual Review')
  const navinsRows = rows.filter((r) => r.routing === 'NAVINS Renew')

  const distribution: Record<string, number> = {}
  for (const row of rows) {
    const key = `${row.routing} | ${row.status}`
    distribution[key] = (distribution[key] ?? 0) + 1
  }

  console.log('=== Full status distribution (routing | status | count) ===')
  Object.entries(distribution)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, count]) => console.log(`  ${key}: ${count}`))
  console.log(`\nManual Review total: ${manualRows.length}`)
  console.log(`Navins Renew total: ${navinsRows.length}`)

  // --- Escalated ---
  const escalatedRows = manualRows.filter((r) => r.status === 'Escalated')
  console.log(`\n=== Escalated rows (Manual Review): ${escalatedRows.length} ===`)
  console.log('If migrated, each maps Escalated -> In Review (fallback, no direct equivalent).')
  for (const row of escalatedRows) {
    console.log(`\n  ${row.policyId} (${row.country})  Escalated -> In Review`)
    const history = await activityHistory(row.policyId)
    history.forEach((entry) => console.log(`    ${summarizeEntry(entry)}`))
  }

  // --- Manual Review Closed: recovered vs unrecoverable ---
  const closedRows = manualRows.filter((r) => r.status === 'Closed')
  const recovered: Array<{ id: string; to: string }> = []
  const unrecoverable: Row[] = []

  for (const row of closedRows) {
    const activityResult = await db.execute({
      sql: `SELECT detail, createdAt FROM activity_log WHERE policyId = ? AND eventType = 'status_change' ORDER BY createdAt DESC`,
      args: [row.policyId],
    })
    let recoveredStatus: string | null = null
    for (const entry of activityResult.rows) {
      let detail: { from?: string; to?: string } = {}
      try {
        detail = JSON.parse(entry.detail as string)
      } catch {
        continue
      }
      if (detail.to === 'Closed') {
        if (detail.from === 'Renewed' || detail.from === 'Not Renewed') {
          recoveredStatus = detail.from
        }
        break
      }
    }
    if (recoveredStatus) {
      recovered.push({ id: row.policyId, to: recoveredStatus })
    } else {
      unrecoverable.push(row)
    }
  }

  console.log(`\n=== Manual Review Closed: ${closedRows.length} total ===`)
  console.log(`Cleanly recovered (${recovered.length}):`)
  recovered.forEach((r) => console.log(`  ${r.id} -> ${r.to}`))

  console.log(`\nUNRECOVERABLE / provisional (${unrecoverable.length}) -- full activity history for each:`)
  for (const row of unrecoverable) {
    console.log(`\n  ${row.policyId} (${row.country})  current status: Closed`)
    const history = await activityHistory(row.policyId)
    history.forEach((entry) => console.log(`    ${summarizeEntry(entry)}`))
  }

  // --- Navins Renew Done ---
  const doneRows = navinsRows.filter((r) => r.status === 'Done')
  console.log(`\n=== Navins Renew Done: ${doneRows.length} total (all provisional -- no source of truth) ===`)
  for (const row of doneRows) {
    console.log(`\n  ${row.policyId} (${row.country})  current status: Done`)
    const history = await activityHistory(row.policyId)
    history.forEach((entry) => console.log(`    ${summarizeEntry(entry)}`))
  }

  const totalProvisional = escalatedRows.length + unrecoverable.length + doneRows.length
  console.log(`\n=== Summary ===`)
  console.log(`Total rows: ${rows.length}`)
  console.log(`Escalated (fallback mapping, not a data-loss case): ${escalatedRows.length}`)
  console.log(`Closed, cleanly recovered: ${recovered.length}`)
  console.log(`Closed, unrecoverable/provisional: ${unrecoverable.length}`)
  console.log(`Done, provisional (no source of truth): ${doneRows.length}`)
  console.log(`Total provisional/flagged rows (Escalated + unrecoverable Closed + Done): ${totalProvisional}`)
  console.log('\nThis was a read-only dry run. No changes were made.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
