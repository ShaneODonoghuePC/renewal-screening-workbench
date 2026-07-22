// Phase 2A status-workflow migration -- PRODUCTION APPLY, run once against Turso.
//
// This is a dedicated, minimal apply step, deliberately separate from
// migrate-status-workflow.ts (hardcoded to local.db) and dry-run-migration-turso.ts
// (read-only by construction). It exists only because applying to Turso was explicitly
// authorized after reviewing dry-run-migration-turso.ts's output. It is not meant to be
// reusable or re-run -- it encodes the exact, already-confirmed mapping for this one pass:
//
//   Manual Review: New -> Not Started (plain relabel)
//                  In Review / Renewed / Not Renewed -> unchanged
//                  Escalated -> In Review (fallback, logged)
//                  Closed -> recovered Renewed/Not Renewed from activity log where
//                            possible, else provisional Renewed (logged either way)
//   Navins Renew:  Pending -> Not Started (plain relabel)
//                  Done -> Renewed (provisional, no source of truth, logged)
//
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.local. Prints the full plan
// before writing anything, then applies it and writes status_migration activity log
// entries for every flagged/provisional row, matching the local.db migration's format.
//
// Run with: npx tsx scripts/apply-migration-turso.ts

import { createClient } from '@libsql/client'
import { readFileSync } from 'fs'
import path from 'path'

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

type Row = { policyId: string; status: string; routing: string }

type PlannedChange = { policyId: string; from: string; to: string; logReason: string | null }

function nowIso() {
  return new Date().toISOString()
}

async function main() {
  console.log(`Target: ${DB_URL}\n`)

  const rowsResult = await db.execute(`
    SELECT rs.policyId as policyId, rs.status as status, p.routing as routing
    FROM review_states rs
    JOIN policies p ON p.id = rs.policyId
  `)
  const rows = rowsResult.rows as unknown as Row[]

  const manualRows = rows.filter((r) => r.routing === 'Manual Review')
  const navinsRows = rows.filter((r) => r.routing === 'NAVINS Renew')

  const plan: PlannedChange[] = []

  for (const row of manualRows) {
    if (row.status === 'New') {
      plan.push({ policyId: row.policyId, from: 'New', to: 'Not Started', logReason: null })
    } else if (row.status === 'Escalated') {
      plan.push({
        policyId: row.policyId,
        from: 'Escalated',
        to: 'In Review',
        logReason: 'Phase 2A migration: Escalated has no direct equivalent in the new graph; mapped to In Review as the safest fallback.',
      })
    } else if (row.status === 'In Review' || row.status === 'Renewed' || row.status === 'Not Renewed') {
      // Already valid -- no change, no log entry.
    } else if (row.status === 'Closed') {
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
        plan.push({
          policyId: row.policyId,
          from: 'Closed',
          to: recoveredStatus,
          logReason: `Phase 2A migration: recovered from activity log (was ${recoveredStatus} immediately before Closed).`,
        })
      } else {
        plan.push({
          policyId: row.policyId,
          from: 'Closed',
          to: 'Renewed',
          logReason: 'Phase 2A migration: UNRECOVERABLE -- no Renewed/Not Renewed decision found in activity log before Closed. Provisional mapping, confirmed by user for production apply.',
        })
      }
    } else {
      console.log(`  ! Unexpected Manual Review status "${row.status}" on ${row.policyId} -- left untouched`)
    }
  }

  for (const row of navinsRows) {
    if (row.status === 'Pending') {
      plan.push({ policyId: row.policyId, from: 'Pending', to: 'Not Started', logReason: null })
    } else if (row.status === 'Done') {
      plan.push({
        policyId: row.policyId,
        from: 'Done',
        to: 'Renewed',
        logReason: 'Phase 2A migration: no source of truth for which terminal state (Quote Declined/Renewed/Not Renewed) this Done row should map to. Provisional mapping, confirmed by user for production apply.',
      })
    } else {
      console.log(`  ! Unexpected Navins Renew status "${row.status}" on ${row.policyId} -- left untouched`)
    }
  }

  console.log(`=== Plan (${plan.length} rows will change) ===`)
  for (const change of plan) {
    console.log(`  ${change.policyId}: ${change.from} -> ${change.to}${change.logReason ? '  [logged: provisional/flagged]' : '  [plain relabel]'}`)
  }

  console.log('\nApplying...')
  for (const change of plan) {
    await db.execute({
      sql: `UPDATE review_states SET status = ? WHERE policyId = ?`,
      args: [change.to, change.policyId],
    })
    if (change.logReason) {
      await db.execute({
        sql: `INSERT INTO activity_log (id, policyId, eventType, userId, detail, createdAt) VALUES (?, ?, 'status_migration', NULL, ?, ?)`,
        args: [
          `ACT-MIGRATE-${change.policyId}-${Date.now()}`,
          change.policyId,
          JSON.stringify({ from: change.from, to: change.to, reason: change.logReason }),
          nowIso(),
        ],
      })
    }
  }

  console.log(`\nDone. ${plan.length} rows updated, ${plan.filter((c) => c.logReason).length} status_migration activity entries written.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
