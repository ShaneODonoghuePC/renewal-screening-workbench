// Splits a policy's flagReasons string (comma-separated, fixed rule order, SPEC.md
// S3.4) into individual reason strings -- the ONE place this split happens (2026-09-10,
// moved here from app/page.tsx). Renewal Management's flag-type filter and
// RiskQualityPanel's Attention Flags sub-header both import this rather than each
// re-parsing flagReasons on their own.
export function flagList(flagReasons: string | null): string[] {
  if (!flagReasons) return []
  return flagReasons.split(',').map((s) => s.trim()).filter(Boolean)
}

const ATTENTION_PREFIX = 'Attention: '

// The four attention-only flag reasons (Data Incomplete, D&B Predictor Concern, D&B
// Significant Event, D&B Listed Status Unknown -- SPEC.md S3.2) are prefixed
// "Attention: " in flagReasons and never get their own Y/N row in FlagDetailPanel.
// Returns them with that prefix stripped, since a caller rendering them under its own
// "Attention Flags" heading doesn't need to repeat it.
export function attentionOnlyFlags(flagReasons: string | null): string[] {
  return flagList(flagReasons)
    .filter((flag) => flag.startsWith(ATTENTION_PREFIX))
    .map((flag) => flag.slice(ATTENTION_PREFIX.length))
}

// The complement of attentionOnlyFlags -- every fired flag that DOES get its own Y/N row
// somewhere (FlagDetailPanel's two tables), in the same fixed rule order flagReasons
// already carries them in. Used by RiskQualityPanel's "Flags Raised" inline summary
// (2026-09-11) so that line and the Attention Flags line above it never repeat the same
// entry -- each reason in flagReasons appears in exactly one of the two.
export function scoringFlags(flagReasons: string | null): string[] {
  return flagList(flagReasons).filter((flag) => !flag.startsWith(ATTENTION_PREFIX))
}
