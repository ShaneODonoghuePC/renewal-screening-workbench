// Shared plan-computation logic for correcting routing on synthesized policies that
// violate the dataset's actual routing rule: a policy with zero flags fired must be
// RPUX Auto Renew, and a policy with any flag fired must be Manual Review or NAVINS
// Renew. lib/synthesizePlan.ts's generator originally sampled routing and flags as two
// independent random draws, so some of the 66-67 policies it added violated this rule
// (e.g. RPX-DK-10137: Manual Review with zero flags fired). That generator bug is
// already fixed (routing is now derived from whether any flag fired); this module finds
// and corrects the already-inserted rows that violate the corrected rule.
//
// Corrections are scoped to synthesized rows ONLY -- the original policies this dataset
// shipped with are never touched, even if one of them happens to trip the same
// zero-flags/flagged-routing check. computeFixRoutingPlan() only ever issues SELECT
// queries (read-only); applyFixRoutingPlan() is the only place any UPDATE happens, and it
// only ever updates the `routing` column on policies.id -- never review_states,
// activity_log, or comments.
//
// Synthesized rows have no separate "is synthesized" column to check, so they're
// identified structurally, the same way applySynthesizePlan() left them:
//   - id matches the dominant RPX-{country}-{NNNNN} numbering scheme (not the separate
//     "{country}-10.101-{NNNNN}/25/01" scheme some original rows use)
//   - zero activity_log rows and zero comments rows (synthesis never touches either
//     table, and a freshly-inserted policy has no review history yet)
//   - review_states row (if any -- RPUX Auto Renew never gets one) has status
//     'Not Started' and assignedUserId NULL, exactly what applySynthesizePlan() inserts
//   - its numeric ID suffix is part of an unbroken, strictly consecutive run at the very
//     top of that country's RPX-{country}-{NNNNN} numbering -- nextNumber was
//     incremented by exactly 1 per new row with no gaps or reuse, so the synthesized
//     batch can only ever occupy one contiguous block immediately above whatever the
//     original max was. The run stops the instant a row fails the signature above OR
//     there's a gap in the numbering -- both are real signals of "this is original data,"
//     confirmed by spot-checking: every row immediately below every observed boundary
//     either has a real review status/assignee/activity or sits across a numbering gap
//     that already existed in the original dataset.

import type { Client } from '@libsql/client'

const COUNTRIES = ['DK', 'NO', 'SE', 'FI'] as const
type Country = (typeof COUNTRIES)[number]

// Same mulberry32 + FNV-1a approach as lib/mockRiskQuality.ts and lib/synthesizePlan.ts,
// duplicated rather than imported so this module's plan is fully self-contained and can't
// silently change if synthesizePlan.ts's generation algorithm changes later. Used only to
// deterministically choose Manual Review vs. NAVINS Renew for the (currently
// nonexistent, but structurally possible) case of a synthesized Auto Renew row with a
// flag fired -- so re-running this plan always proposes the same correction.
function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed
  return function random() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function weightedPick<T extends string>(rand: () => number, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as Array<[T, number]>
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let roll = rand() * total
  for (const [key, w] of entries) {
    roll -= w
    if (roll <= 0) return key
  }
  return entries[entries.length - 1][0]
}

const FLAG_KEYS = [
  'openClaim', 'premiumUnpaid', 'renewalTypeManual', 'systemListedCompany',
  'dnbNoMatch', 'dnbStatusInactive', 'dnbRatingBelowA', 'latestProfitNegative',
  'assetsMovedSignificant', 'dnbListedCompany',
] as const

type PolicyRow = {
  id: string
  country: string
  routing: string | null
} & Record<(typeof FLAG_KEYS)[number], boolean>

type ReviewState = { policyId: string; status: string; assignedUserId: string | null }

export type RoutingCorrection = {
  id: string
  country: string
  from: string
  to: string
  reason: 'flagged-routing-no-flags' | 'auto-renew-with-flags'
}

export type SkippedOriginalViolation = {
  id: string
  country: string
  routing: string
  reason: 'flagged-routing-no-flags' | 'auto-renew-with-flags'
}

export type FixRoutingPlan = {
  corrections: RoutingCorrection[]
  skippedOriginalViolations: SkippedOriginalViolation[]
  synthesizedRowCount: number
}

function anyFlagFired(row: PolicyRow): boolean {
  return FLAG_KEYS.some((key) => row[key])
}

// Read-only: SELECT-only against policies/review_states/activity_log/comments, then pure
// computation. No INSERT/UPDATE anywhere in this function or anything it calls.
export async function computeFixRoutingPlan(db: Client): Promise<FixRoutingPlan> {
  const policiesResult = await db.execute('SELECT * FROM policies')
  const allRows = policiesResult.rows as unknown as PolicyRow[]

  const reviewStatesResult = await db.execute('SELECT policyId, status, assignedUserId FROM review_states')
  const reviewStateByPolicyId = new Map<string, ReviewState>()
  for (const rs of reviewStatesResult.rows as unknown as ReviewState[]) reviewStateByPolicyId.set(rs.policyId, rs)

  const activityCounts = await db.execute('SELECT policyId, COUNT(*) as c FROM activity_log GROUP BY policyId')
  const activityCountByPolicyId = new Map<string, number>()
  for (const r of activityCounts.rows as unknown as Array<{ policyId: string; c: number }>) activityCountByPolicyId.set(r.policyId, Number(r.c))

  const commentCounts = await db.execute('SELECT policyId, COUNT(*) as c FROM comments GROUP BY policyId')
  const commentCountByPolicyId = new Map<string, number>()
  for (const r of commentCounts.rows as unknown as Array<{ policyId: string; c: number }>) commentCountByPolicyId.set(r.policyId, Number(r.c))

  function hasSynthesizedSignature(row: PolicyRow): boolean {
    if (activityCountByPolicyId.get(row.id)) return false
    if (commentCountByPolicyId.get(row.id)) return false
    const rs = reviewStateByPolicyId.get(row.id)
    if (row.routing === 'RPUX Auto Renew') return rs === undefined
    return rs !== undefined && rs.status === 'Not Started' && rs.assignedUserId === null
  }

  const byCountry = new Map<Country, PolicyRow[]>()
  for (const country of COUNTRIES) byCountry.set(country, [])
  for (const row of allRows) byCountry.get(row.country as Country)?.push(row)

  const idPattern = /^RPX-([A-Z]{2})-(\d+)$/

  const synthesizedIds = new Set<string>()
  for (const country of COUNTRIES) {
    const numbered = (byCountry.get(country) ?? [])
      .map((row) => {
        const match = idPattern.exec(row.id)
        return match && match[1] === country ? { row, num: Number(match[2]) } : null
      })
      .filter((x): x is { row: PolicyRow; num: number } => x !== null)
      .sort((a, b) => b.num - a.num)

    let expectedNum = numbered[0]?.num
    for (const { row, num } of numbered) {
      if (num !== expectedNum || !hasSynthesizedSignature(row)) break
      synthesizedIds.add(row.id)
      expectedNum = num - 1
    }
  }

  // Per-country weights for choosing between the two flagged-routing buckets, computed
  // only from rows this plan is not itself correcting/skipping-as-violations -- i.e. the
  // trustworthy existing proportions between Manual Review and NAVINS Renew.
  const flaggedRoutingCountsByCountry = new Map<Country, Record<string, number>>()
  for (const country of COUNTRIES) {
    const counts: Record<string, number> = {}
    for (const row of byCountry.get(country) ?? []) {
      if (row.routing === 'RPUX Auto Renew' || !row.routing) continue
      const violatesFlaggedNoFlags = !anyFlagFired(row)
      if (violatesFlaggedNoFlags) continue
      counts[row.routing] = (counts[row.routing] ?? 0) + 1
    }
    flaggedRoutingCountsByCountry.set(country, counts)
  }

  const corrections: RoutingCorrection[] = []
  const skippedOriginalViolations: SkippedOriginalViolation[] = []

  for (const row of allRows) {
    const isAutoRenewRow = row.routing === 'RPUX Auto Renew'
    const anyFlag = anyFlagFired(row)
    const violated = (isAutoRenewRow && anyFlag) || (!isAutoRenewRow && !anyFlag)
    if (!violated || !row.routing) continue

    const reason: RoutingCorrection['reason'] = isAutoRenewRow ? 'auto-renew-with-flags' : 'flagged-routing-no-flags'

    if (!synthesizedIds.has(row.id)) {
      skippedOriginalViolations.push({ id: row.id, country: row.country, routing: row.routing, reason })
      continue
    }

    let to: string
    if (reason === 'flagged-routing-no-flags') {
      to = 'RPUX Auto Renew'
    } else {
      const rand = mulberry32(hashSeed(`fix-routing-v1:${row.id}`))
      const weights = flaggedRoutingCountsByCountry.get(row.country as Country) ?? {}
      to = Object.keys(weights).length > 0 ? weightedPick(rand, weights) : 'Manual Review'
    }

    corrections.push({ id: row.id, country: row.country, from: row.routing, to, reason })
  }

  return { corrections, skippedOriginalViolations, synthesizedRowCount: synthesizedIds.size }
}

export function printFixRoutingPlanReport(plan: FixRoutingPlan) {
  console.log(`Synthesized rows identified (structural signature): ${plan.synthesizedRowCount}`)

  console.log(`\n=== Corrections to apply (synthesized rows only): ${plan.corrections.length} ===`)
  for (const c of plan.corrections) {
    console.log(`  ${c.id} (${c.country}): ${c.from} -> ${c.to}  [${c.reason}]`)
  }

  console.log(`\n=== Violations found on ORIGINAL rows -- reported only, NOT corrected: ${plan.skippedOriginalViolations.length} ===`)
  for (const v of plan.skippedOriginalViolations) {
    console.log(`  ${v.id} (${v.country}): routing=${v.routing}  [${v.reason}]`)
  }
}

// The only place any UPDATE happens. Touches policies.routing only, on exactly the rows
// in plan.corrections -- never review_states, activity_log, or comments, and never any
// row in plan.skippedOriginalViolations.
export async function applyFixRoutingPlan(db: Client, plan: FixRoutingPlan) {
  for (const c of plan.corrections) {
    await db.execute({ sql: 'UPDATE policies SET routing = ? WHERE id = ?', args: [c.to, c.id] })
  }
}
