// One-off schema migration (SPEC.md S3.3/S3.1, 2026-09-11): adds the four new
// policies columns -- consolidatedAccounts, latestConsolidatedProfitNegative,
// consolidatedAssetsMovedSignificant (all INTEGER/boolean, default 0), and businessLine
// (TEXT, default 'D&O') -- via ALTER TABLE ADD COLUMN ... DEFAULT, which SQLite/libSQL
// backfills onto every existing row automatically. There is no drizzle-kit/migrations
// tooling in this project (lib/db/schema.ts is hand-written, SPEC.md S9), so this is a
// plain script, the same category as migrate-status-workflow.ts.
//
// Idempotent: each ALTER is wrapped so an "duplicate column name" error (already
// applied) is swallowed rather than treated as a failure -- safe to re-run.
//
// Hardcoded to file:./local.db. See migrate-add-consolidated-and-business-line-columns-turso.ts
// for the separate, dedicated Turso script (run manually against production, snapshotted
// first via the surrounding apply scripts -- this migration itself only ADDs columns
// with a default, never touches existing column values, so it carries negligible risk,
// but the snapshot before the DATA-filling steps that follow it still applies).
//
// Run with: npx tsx scripts/migrate-add-consolidated-and-business-line-columns.ts

import { createClient } from '@libsql/client'

const DB_URL = 'file:./local.db'
const db = createClient({ url: DB_URL })

const STATEMENTS = [
  `ALTER TABLE policies ADD COLUMN consolidatedAccounts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE policies ADD COLUMN latestConsolidatedProfitNegative INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE policies ADD COLUMN consolidatedAssetsMovedSignificant INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE policies ADD COLUMN businessLine TEXT NOT NULL DEFAULT 'D&O'`,
]

async function main() {
  console.log(`Migrating schema against: ${DB_URL}\n`)
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
