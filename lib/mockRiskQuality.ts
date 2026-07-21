export type Grade = 'A' | 'B' | 'C'
export type Momentum = 'stable' | 'up' | 'down'

export type DimensionGrade = { grade: Grade; momentum: Momentum; reason: string }

export type RiskQualityInput = {
  id: string
  openClaim: boolean
  premiumUnpaid: boolean
  renewalTypeManual: boolean
  systemListedCompany: boolean
  dnbNoMatch: boolean
  dnbStatusInactive: boolean
  dnbRatingBelowA: boolean
  latestProfitNegative: boolean
  assetsMovedSignificant: boolean
}

export type RiskQuality = {
  verified: boolean
  operational: DimensionGrade
  // null when Unverified — Company & Financial is only calculated once Data Confidence
  // is Verified, same gating as the real methodology this prototypes.
  companyFinancial: DimensionGrade | null
  // Still mocked: no real prior-cycle claims trajectory data exists yet.
  historical: DimensionGrade
  // 3-cycle mocked loss-ratio trend (oldest -> newest), ending at the current cycle's
  // lossRatio below — drives the Historical card's sparkline and Watch tag.
  lossRatioTrend: [number, number, number]
  trendWatch: boolean
  historicalPerformance: {
    lossRatio: number
    claimsPaid: number
    cumulativePremium: number
    claimFrequency: number
    tenureYears: number
  }
  renewalEconomics: {
    expiringPremium: number
    renewalPremium: number
    movementPercent: number
  }
}

// Data Confidence: Verified unless D&B couldn't match the company or shows it inactive.
export function computeDataConfidence(policy: RiskQualityInput): boolean {
  return !policy.dnbNoMatch && !policy.dnbStatusInactive
}

// Operational grade, from the real Stage 1 flags: Open Claim / Premium Unpaid alone force
// a C (regardless of flag count); otherwise C only kicks in at 2+ flags fired.
export function computeOperationalGrade(policy: RiskQualityInput): Grade {
  const stage1Flags = [policy.openClaim, policy.premiumUnpaid, policy.renewalTypeManual, policy.systemListedCompany]
  const firedCount = stage1Flags.filter(Boolean).length
  if (policy.openClaim || policy.premiumUnpaid || firedCount >= 2) return 'C'
  if (firedCount === 1) return 'B'
  return 'A'
}

// Company & Financial grade, from the real Stage 2 flags (D&B Listed Company stays
// excluded — informational only, same as the real methodology).
export function computeCompanyFinancialGrade(policy: RiskQualityInput): Grade {
  const flags = [policy.dnbRatingBelowA, policy.latestProfitNegative, policy.assetsMovedSignificant]
  const firedCount = flags.filter(Boolean).length
  if (firedCount >= 2) return 'C'
  if (firedCount === 1) return 'B'
  return 'A'
}

// One-line "why" for the Operational grade, naming the real fired flags (same labels
// used in FlagDetailPanel/FlagRow, so this never contradicts the flags shown elsewhere).
function operationalReason(policy: RiskQualityInput): string {
  const fired: string[] = []
  if (policy.openClaim) fired.push('Open Claim')
  if (policy.premiumUnpaid) fired.push('Premium Unpaid')
  if (policy.renewalTypeManual) fired.push('Renewal Type Manual')
  if (policy.systemListedCompany) fired.push('System Listed Company')
  return fired.length > 0 ? fired.join(', ') : 'no flags raised'
}

// One-line "why" for the Company & Financial grade, naming the real fired flags.
function companyFinancialReason(policy: RiskQualityInput): string {
  const fired: string[] = []
  if (policy.dnbRatingBelowA) fired.push('D&B Rating Below A')
  if (policy.latestProfitNegative) fired.push('Latest Profit Negative')
  if (policy.assetsMovedSignificant) fired.push('Assets Moved >25% YoY')
  return fired.length > 0 ? fired.join(', ') : 'no flags raised'
}

// One-line "why" for the Historical grade, tied to the mocked loss-ratio trend.
function historicalReason(grade: Grade, trend: [number, number, number]): string {
  const deltaPts = Math.round((trend[2] - trend[0]) * 100)
  const pct = Math.round(trend[2] * 100)
  const direction = deltaPts >= 3 ? `trending up to ${pct}%` : deltaPts <= -3 ? `trending down to ${pct}%` : `steady around ${pct}%`
  return `${grade} — loss ratio ${direction}`
}

// FNV-1a string hash -> deterministic per-policy seed, so the still-mocked fields below
// stay stable across reloads/renders for a given policy instead of reshuffling every render.
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

// Box-Muller transform over two uniform draws -> one approximately-normal value.
function randNormal(rand: () => number, mean: number, sd: number): number {
  const u1 = Math.max(rand(), 1e-9)
  const u2 = rand()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * sd
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const GRADES: Grade[] = ['A', 'A', 'B', 'B', 'C']
const MOMENTA: Momentum[] = ['stable', 'stable', 'stable', 'up', 'down']

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

// Assembles risk-quality data for a Manual Review policy. Data Confidence and the
// Operational / Company & Financial grades are computed from the policy's real flag
// data (see computeDataConfidence / computeOperationalGrade / computeCompanyFinancialGrade
// above). Everything else here has no real data source yet, so it's mocked, deterministic
// per policy id: momentum for all three dimensions, the Historical grade and its
// loss-ratio trend, and the Historical performance / renewal economics figures.
export function getRiskQuality(policy: RiskQualityInput): RiskQuality {
  const rand = mulberry32(hashSeed(policy.id))

  const verified = computeDataConfidence(policy)
  const operationalGrade = computeOperationalGrade(policy)
  const operationalMomentum = pick(rand, MOMENTA)
  const companyFinancialMomentum = pick(rand, MOMENTA)
  const companyFinancialGrade = verified ? computeCompanyFinancialGrade(policy) : null

  const historicalGrade = pick(rand, GRADES)
  const historicalMomentum = pick(rand, MOMENTA)

  // Loss ratio first, from a bell curve centered on a plausible commercial P&C target
  // (60% mean, 15pt SD -- an assumption, easy to retune since this is mocked), clamped to
  // a realistic range. claimsPaid is then derived from it so the three Historical
  // performance figures are always internally consistent by construction
  // (lossRatio === claimsPaid / cumulativePremium), instead of three independent draws
  // that could visibly contradict each other.
  const lossRatio = clamp(randNormal(rand, 0.6, 0.15), 0.15, 1.3)
  const cumulativePremium = Math.round(50000 + rand() * 200000)
  const claimsPaid = Math.round(lossRatio * cumulativePremium)
  const claimFrequency = Math.round(rand() * 30) / 10
  const tenureYears = 1 + Math.floor(rand() * 12)

  // Mocked 3-cycle loss-ratio trend ending at the current lossRatio -- drives the
  // Historical card's sparkline and Watch tag. Previously these reused dnbScoreHistory,
  // which is really a Company & Financial (D&B) signal, not a historical-claims one.
  const stepA = (rand() - 0.5) * 0.24
  const stepB = (rand() - 0.5) * 0.24
  const midRatio = clamp(lossRatio - stepB, 0.1, 1.4)
  const oldRatio = clamp(midRatio - stepA, 0.1, 1.4)
  const lossRatioTrend: [number, number, number] = [oldRatio, midRatio, lossRatio]

  const worsening = lossRatioTrend[2] > lossRatioTrend[1] && lossRatioTrend[1] > lossRatioTrend[0]
  // Watch: the 3-cycle loss-ratio trend is worsening but that hasn't (yet) moved the grade this cycle.
  const trendWatch = worsening && historicalMomentum === 'stable'

  const expiringPremium = Math.round(20000 + rand() * 80000)
  const movementPercent = Math.round((rand() * 30 - 10) * 10) / 10
  const renewalPremium = Math.round(expiringPremium * (1 + movementPercent / 100))

  return {
    verified,
    operational: {
      grade: operationalGrade,
      momentum: operationalMomentum,
      reason: `${operationalGrade} — ${operationalReason(policy)}`,
    },
    companyFinancial: companyFinancialGrade
      ? {
          grade: companyFinancialGrade,
          momentum: companyFinancialMomentum,
          reason: `${companyFinancialGrade} — ${companyFinancialReason(policy)}`,
        }
      : null,
    historical: {
      grade: historicalGrade,
      momentum: historicalMomentum,
      reason: historicalReason(historicalGrade, lossRatioTrend),
    },
    lossRatioTrend,
    trendWatch,
    historicalPerformance: { lossRatio, claimsPaid, cumulativePremium, claimFrequency, tenureYears },
    renewalEconomics: { expiringPremium, renewalPremium, movementPercent },
  }
}

export type Recommendation = {
  level: 'auto' | 'standard' | 'escalate'
  text: string
  suggestedStatus: 'Renewed' | 'Escalated'
}

// Simple decision matrix over the graded dimensions: any C, or 2+ dimensions downgraded
// this cycle -> escalate; any B or a historical trend-watch -> renew as standard, naming
// what moved; all A with no downgrades -> auto-renew. Company & Financial is left out of
// the matrix entirely while Unverified (it has no grade yet), and that's called out in
// the recommendation text rather than silently ignored.
export function computeRecommendation(rq: RiskQuality): Recommendation {
  const dims: Array<{ label: string; grade: Grade; momentum: Momentum }> = [
    { label: 'Operational', grade: rq.operational.grade, momentum: rq.operational.momentum },
  ]
  if (rq.companyFinancial) dims.push({ label: 'Company & Financial', grade: rq.companyFinancial.grade, momentum: rq.companyFinancial.momentum })
  dims.push({ label: 'Historical', grade: rq.historical.grade, momentum: rq.historical.momentum })

  const suffix = rq.companyFinancial ? '' : ' Company & Financial is not yet graded — Unverified.'

  const cDims = dims.filter((d) => d.grade === 'C')
  const downgraded = dims.filter((d) => d.momentum === 'down')

  if (cDims.length > 0 || downgraded.length >= 2) {
    const reason =
      cDims.length > 0
        ? `${cDims.map((d) => d.label).join(' and ')} graded C`
        : `${downgraded.map((d) => d.label).join(' and ')} downgraded this cycle`
    return { level: 'escalate', suggestedStatus: 'Escalated', text: `Escalate for senior review — ${reason}.${suffix}` }
  }

  const bDims = dims.filter((d) => d.grade === 'B')
  const moved = dims.filter((d) => d.momentum !== 'stable')
  if (bDims.length > 0 || rq.trendWatch) {
    const bits: string[] = []
    if (bDims.length > 0) bits.push(`${bDims.map((d) => d.label).join(' and ')} graded B`)
    if (moved.length > 0) bits.push(moved.map((d) => `${d.label} trending ${d.momentum}`).join(', '))
    if (rq.trendWatch) bits.push('Historical trend worsening (watch)')
    return { level: 'standard', suggestedStatus: 'Renewed', text: `Renew as standard — ${bits.join('; ')}.${suffix}` }
  }

  return {
    level: 'auto',
    suggestedStatus: 'Renewed',
    text: `Auto-renew — all dimensions graded A with no downgrades this cycle.${suffix}`,
  }
}
