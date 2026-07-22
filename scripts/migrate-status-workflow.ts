// Phase 2A status-workflow migration. Rewrites review_states.status values from the old
// model (Manual Review: New/In Review/Escalated/Renewed/Not Renewed/Closed; Navins Renew:
// Pending/Done) to the new one (Manual Review: Not Started/In Review/With Broker/Renewed/
// Not Renewed; Navins Renew: Not Started/Quote Sent/Quote Declined/Policy Sent/Renewed/
// Not Renewed).
//
// Hardcoded to file:./local.db on purpose -- this must never run against the env-configured
// Turso client (lib/db/client.ts), so it doesn't import that module or read TURSO_* env vars
// at all. Do not point this at production without explicit, separate authorization.
//
// Run with: npx tsx scripts/migrate-status-workflow.ts [--apply]
// Without --apply, this is a dry run: it prints exactly what it would do and changes nothing.

import { createClient } from '@libsql/client'

const DB_URL = 'file:./local.db'
const APPLY = process.argv.includes('--apply')

const db = createClient({ url: DB_URL })

type Row = { policyId: string; status: string; routing: string }

function nowIso() {
  return new Date().toISOString()
}

async function logMigrationNote(policyId: string, from: string, to: string, reason: string) {
  if (!APPLY) return
  await db.execute({
    sql: `INSERT INTO activity_log (id, policyId, eventType, userId, detail, createdAt) VALUES (?, ?, 'status_migration', NULL, ?, ?)`,
    args: [
      `ACT-MIGRATE-${policyId}-${Date.now()}`,
      policyId,
      JSON.stringify({ from, to, reason }),
      nowIso(),
    ],
  })
}

async function setStatus(policyId: string, newStatus: string) {
  if (!APPLY) return
  await db.execute({
    sql: `UPDATE review_states SET status = ? WHERE policyId = ?`,
    args: [newStatus, policyId],
  })
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no changes will be made)'}`)
  console.log(`Database: ${DB_URL}\n`)

  const rowsResult = await db.execute(`
    SELECT rs.policyId as policyId, rs.status as status, p.routing as routing
    FROM review_states rs
    JOIN policies p ON p.id = rs.policyId
  `)
  const rows = rowsResult.rows as unknown as Row[]

  const manualRows = rows.filter((r) => r.routing === 'Manual Review')
  const navinsRows = rows.filter((r) => r.routing === 'NAVINS Renew')

  let plainRelabelCount = 0
  const unchanged: string[] = []
  const recovered: Array<{ id: string; from: string; to: string }> = []
  const provisional: Array<{ id: string; from: string; to: string; reason: string }> = []

  // --- Manual Review ---
  for (const row of manualRows) {
    if (row.status === 'New') {
      await setStatus(row.policyId, 'Not Started')
      plainRelabelCount++
    } else if (row.status === 'Escalated') {
      // No direct equivalent in the new graph -- flagged mapping, not a silent default.
      await setStatus(row.policyId, 'In Review')
      await logMigrationNote(row.policyId, 'Escalated', 'In Review', 'Phase 2A migration: Escalated has no direct equivalent in the new graph; mapped to In Review as the safest fallback.')
      provisional.push({ id: row.policyId, from: 'Escalated', to: 'In Review', reason: 'no direct equivalent (fallback, per instructions)' })
    } else if (row.status === 'In Review' || row.status === 'Renewed' || row.status === 'Not Renewed') {
      // Already a valid value in the new graph -- no change. Note: Renewed/Not Renewed
      // are newly terminal, so these rows will start appearing in Closed Items with no
      // status value change at all.
      unchanged.push(row.policyId)
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
        await setStatus(row.policyId, recoveredStatus)
        await logMigrationNote(row.policyId, 'Closed', recoveredStatus, `Phase 2A migration: recovered from activity log (was ${recoveredStatus} immediately before Closed).`)
        recovered.push({ id: row.policyId, from: 'Closed', to: recoveredStatus })
      } else {
        // Not cleanly recoverable: went straight from Escalated (or similar) to Closed
        // with no Renewed/Not Renewed decision ever recorded. Provisional default for
        // local.db verification only -- NOT confirmed, flagged for review.
        const provisionalStatus = 'Renewed'
        await setStatus(row.policyId, provisionalStatus)
        await logMigrationNote(row.policyId, 'Closed', provisionalStatus, 'Phase 2A migration: UNRECOVERABLE -- no Renewed/Not Renewed decision found in activity log before Closed. Provisional mapping for local.db verification only, pending confirmation.')
        provisional.push({ id: row.policyId, from: 'Closed (unrecoverable)', to: provisionalStatus, reason: 'no Renewed/Not Renewed decision in activity log before Closed' })
      }
    } else {
      console.log(`  ! Unexpected Manual Review status "${row.status}" on ${row.policyId} -- left untouched`)
    }
  }

  // --- Navins Renew ---
  for (const row of navinsRows) {
    if (row.status === 'Pending') {
      await setStatus(row.policyId, 'Not Started')
      plainRelabelCount++
    } else if (row.status === 'Done') {
      // No source of truth for which terminal state -- provisional default for
      // local.db verification only, matching the "treat as Renewed" default you
      // indicated as likely, pending your explicit confirmation.
      const provisionalStatus = 'Renewed'
      await setStatus(row.policyId, provisionalStatus)
      await logMigrationNote(row.policyId, 'Done', provisionalStatus, 'Phase 2A migration: no source of truth for which terminal state (Quote Declined/Renewed/Not Renewed) this Done row should map to. Provisional mapping for local.db verification only, pending confirmation.')
      provisional.push({ id: row.policyId, from: 'Done', to: provisionalStatus, reason: 'no source of truth for which terminal state' })
    } else {
      console.log(`  ! Unexpected Navins Renew status "${row.status}" on ${row.policyId} -- left untouched`)
    }
  }

  console.log(`Manual Review rows: ${manualRows.length}`)
  console.log(`Navins Renew rows: ${navinsRows.length}`)
  console.log(`\nPlain relabels (New->Not Started, Pending->Not Started): ${plainRelabelCount}`)
  console.log(`Unchanged (already valid new-graph values -- In Review/Renewed/Not Renewed): ${unchanged.length}`, unchanged)
  console.log(`\nCleanly recovered from activity log (${recovered.length}):`)
  recovered.forEach((r) => console.log(`  ${r.id}: ${r.from} -> ${r.to}`))
  console.log(`\nPROVISIONAL / FLAGGED mappings, NOT confirmed (${provisional.length}):`)
  provisional.forEach((r) => console.log(`  ${r.id}: ${r.from} -> ${r.to}  (${r.reason})`))

  if (!APPLY) {
    console.log('\nDry run only -- no changes written. Re-run with --apply to write to local.db.')
  } else {
    console.log('\nChanges written to local.db.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
