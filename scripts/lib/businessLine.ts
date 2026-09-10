// Business line as a first-class routing input (SPEC.md S3.1, added 2026-09-11).
//
// In production, routing is not just source system + flags: a business line can force
// Manual Review on its own, regardless of source system or whether any flag fired. A
// real DK Property register is 100% Manual Review this way, with the Flag Reason
// "Business line requires manual review".
//
// D&O is the only business line modelled in THIS version, and D&O does not force
// review -- so MANUAL_REVIEW_FORCED_BUSINESS_LINES is empty and the existing
// source-system+flags routing rule is unchanged in practice. This module exists so the
// routing rule reads a real field (conceptual scaffolding), not so it behaves
// differently today. Property is documented here as the known real example; it is
// deliberately out of scope -- no Property rows exist in this dataset, and adding one
// is a separate, later decision, not something to build speculatively now.
//
// Adding a line-forced business line later means: (1) add it to BUSINESS_LINES, (2) add
// it to MANUAL_REVIEW_FORCED_BUSINESS_LINES, (3) its policies route to Manual Review
// with Flag Reason "Business line requires manual review" regardless of source system or
// flags -- expectedRouting() in scripts/lib/fixRoutingPlan.ts already checks this set
// first, so no other code change is needed.

export const BUSINESS_LINES = ['D&O'] as const
export type BusinessLine = (typeof BUSINESS_LINES)[number]

export const MANUAL_REVIEW_FORCED_BUSINESS_LINES = new Set<string>([])

export const BUSINESS_LINE_FORCED_REVIEW_REASON = 'Business line requires manual review'

export function businessLineForcesManualReview(businessLine: string | null): boolean {
  return businessLine != null && MANUAL_REVIEW_FORCED_BUSINESS_LINES.has(businessLine)
}
