// Single source of truth for the D&B No Match invariant (SPEC.md S3.3/S7.1) and the
// flagReasons/attention formulas that must agree with it -- shared by the data
// generator (synthesizePlan.ts), the invariant fix-plan (fixNoMatchInvariantPlan.ts),
// and the D&B rate-raising plan (raiseDnbRatesPlan.ts), so a generated row and a
// hand-corrected existing row can never disagree about what their own fields mean.
// Pure functions only -- no database or file access anywhere in this module.

export type DnbBooleans = {
  dnbNoMatch: boolean
  dnbStatusInactive: boolean
  dnbRatingBelowA: boolean
  latestProfitNegative: boolean
  assetsMovedSignificant: boolean
  dnbListedCompany: boolean
}

export type DnbFigures = {
  dnbRating: string | null
  latestNetIncome: number | null
  assetsChangePercent: number | null
  dnbOperatingStatusLabel: string | null
  dnbListedExchange: string | null
}

export const STAGE2_FLAG_KEYS: Array<keyof DnbBooleans> = [
  'dnbNoMatch', 'dnbStatusInactive', 'dnbRatingBelowA', 'latestProfitNegative',
  'assetsMovedSignificant', 'dnbListedCompany',
]

// SPEC.md S3.3: D&B No Match means D&B returned nothing about the company, so no other
// Stage 2 flag can be true and no other Stage 2 figure can be populated -- there is no
// D&B finding to report beyond the fact that nothing matched. Pure: returns a corrected
// copy, never mutates its argument.
export function enforceNoMatchInvariant<T extends DnbBooleans & DnbFigures>(row: T): T {
  if (!row.dnbNoMatch) return row
  return {
    ...row,
    dnbStatusInactive: false,
    dnbRatingBelowA: false,
    latestProfitNegative: false,
    assetsMovedSignificant: false,
    dnbListedCompany: false,
    dnbRating: null,
    latestNetIncome: null,
    assetsChangePercent: null,
    dnbOperatingStatusLabel: null,
    dnbListedExchange: null,
  }
}

// True if this row breaks the invariant above -- dnbNoMatch true alongside another
// Stage 2 boolean or a non-null Stage 2 figure. Used both by the fix-plan's checker and
// by the final VERIFY pass (an empty-result query in each of the three environments).
export function violatesNoMatchInvariant(row: DnbBooleans & DnbFigures): boolean {
  if (!row.dnbNoMatch) return false
  return (
    row.dnbStatusInactive || row.dnbRatingBelowA || row.latestProfitNegative ||
    row.assetsMovedSignificant || row.dnbListedCompany ||
    row.dnbRating != null || row.latestNetIncome != null || row.assetsChangePercent != null ||
    row.dnbOperatingStatusLabel != null || row.dnbListedExchange != null
  )
}

export function computeStage2FlagCount(row: DnbBooleans): number {
  return STAGE2_FLAG_KEYS.filter((k) => row[k]).length
}

// Fixed rule order for flagReasons (SPEC.md S3.4) -- Stage 1 first, then Stage 2. D&B
// Status Inactive's entry was added 2026-09-10 (previously missing from the generator
// entirely -- a pre-existing gap that had never been exercised, since zero rows had
// dnbStatusInactive true before this round).
export const FLAG_REASON_LABELS: Array<[string, string]> = [
  ['openClaim', 'Open Claim'],
  ['premiumUnpaid', 'Premium Unpaid'],
  ['renewalTypeManual', 'RPUX set to Manual'],
  ['systemListedCompany', 'Listed Company'],
  ['dnbNoMatch', 'D&B No Match'],
  ['dnbStatusInactive', 'D&B Status Inactive'],
  ['dnbRatingBelowA', 'D&B Rating Classification below A'],
  ['latestProfitNegative', 'D&B Negative Profit'],
  ['assetsMovedSignificant', 'D&B Assets Moved >25% YoY'],
  ['dnbListedCompany', 'D&B Listed Company'],
]

// Rebuilds the graded-flag portion of flagReasons from the row's own current booleans,
// then re-appends whatever "Attention: ..." entries the OLD flagReasons string carried
// verbatim. Those (D&B Predictor Concern / Significant Event / Listed Status Unknown /
// Data Incomplete) are a separate signal from the ten Stage 1/Stage 2 booleans this
// invariant and the rate-raising work touch -- SPEC.md's No Match invariant names only
// the five Stage 2 booleans/figures, not these, so they're deliberately left as they
// were rather than recomputed or dropped.
export function rebuildFlagReasons(row: Record<string, unknown>, previousFlagReasons: string | null): string | null {
  const reasons: string[] = []
  for (const [key, label] of FLAG_REASON_LABELS) {
    if (row[key]) reasons.push(label)
  }
  const attentionOnly = (previousFlagReasons ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('Attention: '))
  reasons.push(...attentionOnly)
  return reasons.length > 0 ? reasons.join(', ') : null
}

export type Attention = 'High' | 'Medium' | 'None'

// SPEC.md S3.2's Medium-trigger rule (Renewal Type Manual, Listed Company, any Stage 2
// D&B flag) reproduced exactly, with dnbStatusInactive included in the Stage 2 check
// (fixed 2026-09-10 -- the generator previously omitted it from this OR-chain, contrary
// to SPEC's own already-documented rule). `previousAttention` is only used as a floor
// when none of the hard booleans below fire -- a row's attention can also be Medium/High
// because of something this formula doesn't model (an attention-only flag such as Data
// Incomplete, or real-data provenance on an original row); this function must never
// silently downgrade that, only ever recompute upward when a hard boolean now fires.
export function computeAttention(
  row: {
    openClaim: boolean
    premiumUnpaid: boolean
    renewalTypeManual: boolean
    systemListedCompany: boolean
  } & DnbBooleans,
  previousAttention: Attention | null = 'None',
): Attention {
  if (row.openClaim || row.premiumUnpaid) return 'High'
  const medium =
    row.renewalTypeManual || row.systemListedCompany || row.dnbNoMatch || row.dnbStatusInactive ||
    row.dnbRatingBelowA || row.latestProfitNegative || row.assetsMovedSignificant || row.dnbListedCompany
  if (medium) return 'Medium'
  return previousAttention ?? 'None'
}
