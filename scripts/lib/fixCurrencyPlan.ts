// Shared plan-computation logic for correcting policies.currency to match each
// policy's country -- DK -> DKK, NO -> NOK, SE -> SEK, FI -> EUR. Relabels the
// currency code only; premium amounts are never touched (these are mocked
// figures, and converting them would imply a precision they don't have).
//
// computeFixCurrencyPlan() only ever issues a SELECT against policies
// (read-only); applyFixCurrencyPlan() is the only place any UPDATE happens,
// and it only ever updates the `currency` column -- never premium or any
// other field.

import type { Client } from '@libsql/client'

export const CURRENCY_BY_COUNTRY: Record<string, string> = {
  DK: 'DKK',
  NO: 'NOK',
  SE: 'SEK',
  FI: 'EUR',
}

type PolicyRow = {
  id: string
  country: string
  currency: string | null
}

export type CurrencyCorrection = {
  id: string
  country: string
  from: string | null
  to: string
}

export type FixCurrencyPlan = {
  corrections: CurrencyCorrection[]
  totalRowsChecked: number
}

function planFromRows(rows: PolicyRow[]): FixCurrencyPlan {
  const corrections: CurrencyCorrection[] = []
  for (const row of rows) {
    const expected = CURRENCY_BY_COUNTRY[row.country]
    if (!expected) continue // unknown country -- not part of this dataset, leave alone
    if (row.currency !== expected) {
      corrections.push({ id: row.id, country: row.country, from: row.currency, to: expected })
    }
  }
  return { corrections, totalRowsChecked: rows.length }
}

// Read-only: SELECT-only against policies, then pure computation. No INSERT/UPDATE
// anywhere in this function or anything it calls.
export async function computeFixCurrencyPlan(db: Client): Promise<FixCurrencyPlan> {
  const result = await db.execute('SELECT id, country, currency FROM policies')
  return planFromRows(result.rows as unknown as PolicyRow[])
}

// Same plan computation, over an in-memory array -- used by the seed-file fixer
// (scripts/fix-currency-seed.ts), which has no database to query.
export function computeFixCurrencyPlanForRows(rows: PolicyRow[]): FixCurrencyPlan {
  return planFromRows(rows)
}

export function printFixCurrencyPlanReport(plan: FixCurrencyPlan) {
  console.log(`Rows checked: ${plan.totalRowsChecked}`)
  console.log(`\n=== Currency mismatches found (country-vs-currency rule): ${plan.corrections.length} ===`)

  const byCountryFrom = new Map<string, number>()
  for (const c of plan.corrections) {
    const key = `${c.country}/${c.from ?? '(null)'}`
    byCountryFrom.set(key, (byCountryFrom.get(key) ?? 0) + 1)
  }
  for (const [key, count] of [...byCountryFrom.entries()].sort()) {
    console.log(`  ${key}: ${count}`)
  }
  for (const c of plan.corrections) {
    console.log(`  ${c.id} (${c.country}): ${c.from ?? '(null)'} -> ${c.to}`)
  }
}

// The only place any UPDATE happens. Touches policies.currency only, on exactly
// the rows in plan.corrections -- never premium, and never any other column.
export async function applyFixCurrencyPlan(db: Client, plan: FixCurrencyPlan) {
  for (const c of plan.corrections) {
    await db.execute({ sql: 'UPDATE policies SET currency = ? WHERE id = ?', args: [c.to, c.id] })
  }
}
