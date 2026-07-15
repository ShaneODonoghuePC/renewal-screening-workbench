import { EMPTY_VALUE } from './format'

export type RenewalMonth = { year: number; month: number }

// Business rule (confirmed 2026-07-15, SPEC.md §5.2): Renewal Month is
// month(renewalDate) + 1, with year rollover — not the raw calendar month.
export function deriveRenewalMonth(renewalDate: string | null | undefined): RenewalMonth | null {
  if (!renewalDate) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(renewalDate)
  if (!match) return null
  const year = Number(match[1])
  const rawMonth = Number(match[2])
  let month = rawMonth + 1
  let rolledYear = year
  if (month > 12) {
    month = 1
    rolledYear += 1
  }
  return { year: rolledYear, month }
}

export function formatRenewalMonth(renewalDate: string | null | undefined): string {
  const derived = deriveRenewalMonth(renewalDate)
  if (!derived) return EMPTY_VALUE
  const date = new Date(Date.UTC(derived.year, derived.month - 1, 1))
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
