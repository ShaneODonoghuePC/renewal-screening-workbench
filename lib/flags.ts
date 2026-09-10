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
