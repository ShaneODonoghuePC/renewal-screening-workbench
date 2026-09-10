// Turso variant of migrate-add-consolidated-and-business-line-columns.ts -- adds
// consolidatedAccounts, latestConsolidatedProfitNegative, consolidatedAssetsMovedSignificant
// (INTEGER, default 0) and businessLine (TEXT, default 'D&O') to the PRODUCTION policies
// table via ALTER TABLE ADD COLUMN ... DEFAULT, which backfills every existing row.
//
// Snapshots the full policies table to a committed JSON file BEFORE making any change,
// same discipline as every other production-touching script here, even though ALTER
// TABLE ADD COLUMN with a DEFAULT only ever adds columns and never touches existing
// column values -- the snapshot is what lets a later step in this same round (the
// consolidated-rate raise) be rolled back to a single known-good "before any of this"
// point if needed.
//
// Idempotent, same as the local.db version.
//
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.local, same as the app does.
//
// Run with: npx tsx scripts/migrate-add-consolidated-and-business-line-columns-turso.ts

import { createClient } from '@libsql/client'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
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

const STATEMENTS = [
  `ALTER TABLE policies ADD COLUMN consolidatedAccounts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE policies ADD COLUMN latestConsolidatedProfitNegative INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE policies ADD COLUMN consolidatedAssetsMovedSignificant INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE policies ADD COLUMN businessLine TEXT NOT NULL DEFAULT 'D&O'`,
]

async function snapshotPolicies(): Promise<string> {
  const result = await db.execute('SELECT * FROM policies')
  const dir = path.resolve(process.cwd(), 'data', 'snapshots')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `policies-pre-consolidated-schema-migration-${stamp}.json`)
  writeFileSync(filePath, JSON.stringify(result.rows, null, 2))
  return filePath
}

async function main() {
  console.log(`Migrating schema against Turso: ${DB_URL}\n`)

  console.log('Snapshotting policies table before making any change...')
  const snapshotPath = await snapshotPolicies()
  console.log(`Snapshot written to ${snapshotPath}\n`)

  for (const sql of STATEMENTS) {
    try {
      await db.execute(sql)
      console.log(`OK: ${sql}`)
    } catch (e: any) {
      if (String(e?.message ?? e).includes('duplicate column name')) {
        console.log(`SKIP (already applied): ${sql}`)
        continue
      }
      throw e
    }
  }
  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
