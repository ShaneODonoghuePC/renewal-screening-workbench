export type Grade = 'A' | 'B' | 'C'
export type Momentum = 'stable' | 'up' | 'down'

export type DimensionGrade = { grade: Grade; momentum: Momentum }

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
  // Still mocked: no real prior-cycle D&B trajectory data exists yet.
  historical: DimensionGrade
  dnbScoreHistory: [number, number, number]
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

const GRADES: Grade[] = ['A', 'A', 'B', 'B', 'C']
const MOMENTA: Momentum[] = ['stable', 'stable', 'stable', 'up', 'down']

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

// Assembles risk-quality data for a Manual Review policy. Data Confidence and the
// Operational / Company & Financial grades are computed from the policy's real flag
// data (see computeDataConfidence / computeOperationalGrade / computeCompanyFinancialGrade
// above). Everything else here has no real data source yet, so it's mocked, deterministic
// per policy id: momentum for Operational and Company & Financial (there's no prior-cycle
// flag snapshot yet to diff against — a known simplification, surfaced in the UI rather
// than silently faked as real), the Historical dimension in full, and the Historical
// performance / renewal economics figures.
export function getRiskQuality(policy: RiskQualityInput): RiskQuality {
  const rand = mulberry32(hashSeed(policy.id))

  const verified = computeDataConfidence(policy)
  const operationalGrade = computeOperationalGrade(policy)
  const operationalMomentum = pick(rand, MOMENTA)
  const companyFinancialMomentum = pick(rand, MOMENTA)
  const companyFinancialGrade = verified ? computeCompanyFinancialGrade(policy) : null

  const historicalGrade = pick(rand, GRADES)
  const historicalMomentum = pick(rand, MOMENTA)

  // 3-cycle D&B score history, oldest first (higher = healthier).
  const base = 40 + Math.floor(rand() * 40)
  const step2 = Math.floor(rand() * 16) - 8
  const step3 = Math.floor(rand() * 16) - 8
  const dnbScoreHistory: [number, number, number] = [base, base + step2, base + step2 + step3]

  const declining = dnbScoreHistory[2] < dnbScoreHistory[1] && dnbScoreHistory[1] < dnbScoreHistory[0]
  // Watch: the 3-cycle trend is worsening but that decline hasn't (yet) moved the grade this cycle.
  const trendWatch = declining && historicalMomentum === 'stable'

  const lossRatio = Math.round(rand() * 90) / 100
  const claimsPaid = Math.round(rand() * 50000)
  const cumulativePremium = Math.round(50000 + rand() * 200000)
  const claimFrequency = Math.round(rand() * 30) / 10
  const tenureYears = 1 + Math.floor(rand() * 12)

  const expiringPremium = Math.round(20000 + rand() * 80000)
  const movementPercent = Math.round((rand() * 30 - 10) * 10) / 10
  const renewalPremium = Math.round(expiringPremium * (1 + movementPercent / 100))

  return {
    verified,
    operational: { grade: operationalGrade, momentum: operationalMomentum },
    companyFinancial: companyFinancialGrade ? { grade: companyFinancialGrade, momentum: companyFinancialMomentum } : null,
    historical: { grade: historicalGrade, momentum: historicalMomentum },
    dnbScoreHistory,
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
    { label: 'Operational', ...rq.operational },
  ]
  if (rq.companyFinancial) dims.push({ label: 'Company & Financial', ...rq.companyFinancial })
  dims.push({ label: 'Historical', ...rq.historical })

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
