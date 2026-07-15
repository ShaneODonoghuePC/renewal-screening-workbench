export const EMPTY_VALUE = 'N/A'

export function formatCurrency(value: number | null | undefined, currency: string | null | undefined) {
  if (value == null) return EMPTY_VALUE
  return value.toLocaleString('en-GB', { style: 'currency', currency: currency || 'DKK' })
}
