export const EMPTY_VALUE = 'N/A'

export function formatCurrency(value: number | null | undefined, currency: string | null | undefined) {
  if (value == null) return EMPTY_VALUE
  return value.toLocaleString('en-GB', { style: 'currency', currency: currency || 'DKK' })
}

// Compact form for tight spaces (e.g. summary cards): ISO-code currencies without a
// distinct symbol (DKK, SEK, NOK...) format as one long space-joined token that can't
// wrap, so full precision risks overflowing a narrow card. Compact notation keeps it short.
export function formatCompactCurrency(value: number | null | undefined, currency: string | null | undefined) {
  if (value == null) return EMPTY_VALUE
  return value.toLocaleString('en-GB', {
    style: 'currency',
    currency: currency || 'DKK',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
}
