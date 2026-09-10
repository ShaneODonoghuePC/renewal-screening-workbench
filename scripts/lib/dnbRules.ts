// Single source of truth for the D&B No Match invariant and the consolidated-accounts
// invariant (SPEC.md S3.3/S7.1), and the flagReasons/attention formulas that must agree
// with them -- shared by the data generator (synthesizePlan.ts), the two invariant
// fix-plans (fixNoMatchInvariantPlan.ts, fixConsolidatedInvariantPlan.ts), and the
// rate-raising plans (raiseDnbRatesPlan.ts, raiseConsolidatedRatesPlan.ts), so a
// generated row and a hand-corrected existing row can never disagree about what their
// own fields mean. Pure functions only -- no database or file access anywhere in this
// module.

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

// Consolidated-accounts trio (SPEC.md S3.3, added 2026-09-11). consolidatedAccounts is
// pure context -- excluded from STAGE2_SCORING_FLAG_KEYS below, from flagReasons, and
// from routing (see scripts/lib/fixRoutingPlan.ts's own FLAG_KEYS). The other two DO
// score and DO contribute to routing, same as any other Stage 2 flag.
export type ConsolidatedBooleans = {
  consolidatedAccounts: boolean
  latestConsolidatedProfitNegative: boolean
  consolidatedAssetsMovedSignificant: boolean
}

export const STAGE2_FLAG_KEYS: Array<keyof DnbBooleans> = [
  'dnbNoMatch', 'dnbStatusInactive', 'dnbRatingBelowA', 'latestProfitNegative',
  'assetsMovedSignificant', 'dnbListedCompany',
]

// The two consolidated flags that score -- NOT consolidatedAccounts itself. Kept as a
// separate list rather than folded into STAGE2_FLAG_KEYS so that list can stay typed as
// exactly DnbBooleans's keys (the No Match invariant's own five dependent fields);
// computeStage2FlagCount below is the one place both lists are combined.
export const CONSOLIDATED_SCORING_FLAG_KEYS: Array<keyof ConsolidatedBooleans> = [
  'latestConsolidatedProfitNegative', 'consolidatedAssetsMovedSignificant',
]

// SPEC.md S3.3: the two consolidated flags can only be true where consolidatedAccounts
// is true -- the real engine leaves them BLANK (could not assess) rather than false when
// no consolidated accounts exist; this prototype does not model blanks, so a false here
// stands for "assessed and clean" OR "nothing to assess," collapsed into one value by
// deliberate simplification (documented, not silently done). Pure: returns a corrected
// copy, never mutates its argument.
export function enforceConsolidatedInvariant<T extends ConsolidatedBooleans>(row: T): T {
  if (row.consolidatedAccounts) return row
  return { ...row, latestConsolidatedProfitNegative: false, consolidatedAssetsMovedSignificant: false }
}

// True if this row breaks the invariant above -- a consolidated dependent flag true
// while consolidatedAccounts is false.
export function violatesConsolidatedInvariant(row: ConsolidatedBooleans): boolean {
  if (row.consolidatedAccounts) return false
  return row.latestConsolidatedProfitNegative || row.consolidatedAssetsMovedSignificant
}

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

// Widened to Record<string, unknown> (2026-09-11) rather than DnbBooleans, since the
// tally now spans two separate boolean groups (DnbBooleans + the two scoring keys from
// ConsolidatedBooleans) that share no single named type -- callers already pass full
// PolicyRow-shaped objects satisfying both.
export function computeStage2FlagCount(row: Record<string, unknown>): number {
  return [...STAGE2_FLAG_KEYS, ...CONSOLIDATED_SCORING_FLAG_KEYS].filter((k) => row[k]).length
}

// Fixed rule order for flagReasons (SPEC.md S3.4) -- Stage 1 first, then Stage 2. D&B
// Status Inactive's entry was added 2026-09-10 (previously missing from the generator
// entirely -- a pre-existing gap that had never been exercised, since zero rows had
// dnbStatusInactive true before this round). The two consolidated entries were added
// 2026-09-11, in the fixed order after D&B Listed Company (SPEC.md S3.3) --
// consolidatedAccounts itself has NO entry here: it contributes no reason string by
// design (pure context, not a scoring flag).
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
  ['latestConsolidatedProfitNegative', 'D&B Negative Profit (Consolidated)'],
  ['consolidatedAssetsMovedSignificant', 'D&B Consolidated Assets Moved >25% YoY'],
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
