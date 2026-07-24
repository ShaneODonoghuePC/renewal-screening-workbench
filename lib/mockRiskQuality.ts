export type Grade = 'A' | 'B' | 'C'
export type Momentum = 'stable' | 'up' | 'down'

export type DimensionGrade = { grade: Grade; momentum: Momentum; reason: string }

export type RiskQualityInput = {
  id: string
  premium: number | null
  renewalDate: string | null
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

// One year of the 3-Yr Loss Ratio table (oldest -> newest).
export type LossRatioYear = {
  year: number
  grossPremiumWritten: number
  claimsIncurred: number
  // Always claimsIncurred / grossPremiumWritten for this exact year -- recomputed from
  // the (rounded) year figures rather than stored as an independent draw, so it can never
  // drift from what the two figures above actually divide out to.
  lossRatio: number
}

export type LossRatioHistory = {
  years: [LossRatioYear, LossRatioYear, LossRatioYear]
  // Simple average across the three years, per the table spec.
  avgGrossPremiumWritten: number
  avgClaimsIncurred: number
  // Exposure-weighted (total Claims Incurred / total Gross Premium Written across all
  // three years) -- NOT a plain average of the three yearly ratios. This is also what
  // the Historical grade is now based on, and what any other "current loss ratio"
  // display in the app should read from (see historicalPerformance.lossRatio below,
  // which is this same history's most recent year).
  threeYearLossRatio: number
}

export type RiskQuality = {
  verified: boolean
  operational: DimensionGrade
  // null when Unverified — Company & Financial is only calculated once Data Confidence
  // is Verified, same gating as the real methodology this prototypes.
  companyFinancial: DimensionGrade | null
  // Still mocked: no real prior-cycle claims trajectory data exists yet. Grade and
  // momentum are both now derived from lossRatioHistory (see below) rather than an
  // independent draw -- single source of truth for the Historical dimension.
  historical: DimensionGrade
  // The data foundation for the 3-Yr Loss Ratio table -- also what the Historical grade
  // and momentum are computed from.
  lossRatioHistory: LossRatioHistory
  // 3-cycle loss-ratio trend (oldest -> newest) taken straight from lossRatioHistory's
  // three years -- drives the Historical card's sparkline and Watch tag.
  lossRatioTrend: [number, number, number]
  trendWatch: boolean
  historicalPerformance: {
    // Same value as lossRatioHistory's most recent year -- the single source of truth
    // for "current loss ratio" everywhere in the app (see RiskQualityPanel's Loss ratio
    // card, which reads this field rather than an independent figure).
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

// Historical grade, thresholded off a loss ratio -- the same way
// computeOperationalGrade/computeCompanyFinancialGrade threshold off real flag counts.
// Fed the 3-year exposure-weighted aggregate loss ratio (LossRatioHistory.threeYearLossRatio),
// not a single year's figure -- one set of bands, reused wherever a loss ratio needs a grade.
// Thresholds are an assumption (mid-50s to low-60s loss ratio is a normal/healthy range
// for commercial P&C), matched to the shipped distribution (mean ~55%, SD ~17pt) so the
// split lands roughly where A/B/C should for this dataset -- easy to retune later.
export function computeHistoricalGrade(lossRatio: number): Grade {
  // Threshold on the rounded percentage rather than the raw fraction, so the grade band
  // can never disagree with the displayed Loss ratio % right at a boundary (e.g. a raw
  // 54.96% displaying as "55%" while still grading as if it were under the B cutoff).
  const pct = Math.round(lossRatio * 100)
  if (pct > 75) return 'C'
  if (pct >= 55) return 'B'
  return 'A'
}

// Historical momentum, derived from the actual year-over-year movement across the same
// three years as the Loss Ratio table (oldest vs. newest) -- rather than an independent
// random pick -- so the arrow, the sparkline, and the table can never visibly disagree.
// Higher loss ratio is worse, so a rising trend is "down" (attention-worthy) and a
// falling one is "up" (improving) -- same up/down semantics as the other two dimensions'
// arrows.
function computeHistoricalMomentum(trend: [number, number, number]): Momentum {
  const deltaPts = Math.round((trend[2] - trend[0]) * 100)
  if (deltaPts >= 3) return 'down'
  if (deltaPts <= -3) return 'up'
  return 'stable'
}

// One-line "why" for the Historical grade, tied to the mocked loss-ratio trend.
function historicalReason(grade: Grade, trend: [number, number, number]): string {
  const deltaPts = Math.round((trend[2] - trend[0]) * 100)
  const pct = Math.round(trend[2] * 100)
  const direction = deltaPts >= 3 ? `trending up to ${pct}%` : deltaPts <= -3 ? `trending down to ${pct}%` : `steady around ${pct}%`
  return `${grade}: loss ratio ${direction}`
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

const MOMENTA: Momentum[] = ['stable', 'stable', 'stable', 'up', 'down']

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

// Exposure-weighted loss ratio across N years (total Claims Incurred / total Gross
// Premium Written) -- the actuarially correct way to aggregate a multi-year loss ratio,
// as opposed to a plain average of the yearly ratios. Exported so any future multi-year
// aggregation reuses this instead of reimplementing plain-average math that would
// silently disagree with it.
export function computeAggregateLossRatio(years: { grossPremiumWritten: number; claimsIncurred: number }[]): number {
  const totalGpw = years.reduce((sum, y) => sum + y.grossPremiumWritten, 0)
  const totalClaims = years.reduce((sum, y) => sum + y.claimsIncurred, 0)
  return totalGpw > 0 ? totalClaims / totalGpw : 0
}

// The most recently *completed* policy year -- one year before the upcoming renewal
// date's year, same convention as the Renewal economics section's expiringYear
// (RiskQualityPanel's renewalYears()). Historical claims experience is necessarily for
// years that have already finished, not the year about to be renewed into.
function mostRecentCompletedYear(renewalDate: string | null): number {
  const fallbackYear = 2025
  if (!renewalDate) return fallbackYear
  const date = new Date(`${renewalDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return fallbackYear
  return date.getUTCFullYear() - 1
}

// Builds the 3-year Loss Ratio table's data (oldest -> newest), pinning the newest year
// to the policy's existing cumulativePremium/claimsPaid so those already-displayed
// figures are preserved exactly, not replaced. The two prior years are synthesized
// backward: a plausible YoY premium trend for Gross Premium Written, and a bell-curve
// walk for the loss ratio (same shape as the old lossRatioTrend), with each year's
// Claims Incurred then derived from that year's own GPW and ratio -- so every year's
// stated loss ratio is exactly claimsIncurred / grossPremiumWritten by construction,
// never an independent figure that could drift from what the two numbers divide out to.
function buildLossRatioHistory(rand: () => number, renewalDate: string | null, gpwYear3: number, claimsYear3: number): LossRatioHistory {
  const newestYear = mostRecentCompletedYear(renewalDate)

  // Same range/shape as renewalEconomics' movementPercent below: roughly -10%..+20% YoY.
  const growth12 = Math.round((rand() * 30 - 10) * 10) / 10
  const growth23 = Math.round((rand() * 30 - 10) * 10) / 10
  const gpwYear2 = Math.round(gpwYear3 / (1 + growth23 / 100))
  const gpwYear1 = Math.round(gpwYear2 / (1 + growth12 / 100))

  const ratioYear3 = claimsYear3 / gpwYear3
  const stepA = (rand() - 0.5) * 0.24
  const stepB = (rand() - 0.5) * 0.24
  const rawRatioYear2 = clamp(ratioYear3 - stepB, 0.1, 1.4)
  const rawRatioYear1 = clamp(rawRatioYear2 - stepA, 0.1, 1.4)
  const claimsYear2 = Math.round(rawRatioYear2 * gpwYear2)
  const claimsYear1 = Math.round(rawRatioYear1 * gpwYear1)

  const years: [LossRatioYear, LossRatioYear, LossRatioYear] = [
    { year: newestYear - 2, grossPremiumWritten: gpwYear1, claimsIncurred: claimsYear1, lossRatio: claimsYear1 / gpwYear1 },
    { year: newestYear - 1, grossPremiumWritten: gpwYear2, claimsIncurred: claimsYear2, lossRatio: claimsYear2 / gpwYear2 },
    { year: newestYear, grossPremiumWritten: gpwYear3, claimsIncurred: claimsYear3, lossRatio: ratioYear3 },
  ]

  return {
    years,
    avgGrossPremiumWritten: years.reduce((sum, y) => sum + y.grossPremiumWritten, 0) / 3,
    avgClaimsIncurred: years.reduce((sum, y) => sum + y.claimsIncurred, 0) / 3,
    threeYearLossRatio: computeAggregateLossRatio(years),
  }
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

  // Seed loss ratio, from a bell curve centered on a plausible commercial P&C target
  // (60% mean, 15pt SD -- an assumption, easy to retune since this is mocked), clamped to
  // a realistic range. claimsPaid is derived from it so cumulativePremium/claimsPaid stay
  // internally consistent -- these two figures become the 3-Yr Loss Ratio table's newest
  // (most recent) year, unchanged from what's already displayed elsewhere in the app.
  const seedLossRatio = clamp(randNormal(rand, 0.6, 0.15), 0.15, 1.3)
  const cumulativePremium = Math.round(50000 + rand() * 200000)
  const claimsPaid = Math.round(seedLossRatio * cumulativePremium)
  const claimFrequency = Math.round(rand() * 30) / 10
  const tenureYears = 1 + Math.floor(rand() * 12)

  // The 3-Yr Loss Ratio table's data foundation -- single source of truth for the
  // Historical grade/momentum below and for "current loss ratio" wherever it's displayed
  // (historicalPerformance.lossRatio, set from this same history's newest year).
  const lossRatioHistory = buildLossRatioHistory(rand, policy.renewalDate, cumulativePremium, claimsPaid)
  const lossRatio = lossRatioHistory.years[2].lossRatio
  const lossRatioTrend: [number, number, number] = [
    lossRatioHistory.years[0].lossRatio,
    lossRatioHistory.years[1].lossRatio,
    lossRatioHistory.years[2].lossRatio,
  ]

  // Grade now comes from the 3-year exposure-weighted aggregate, not a single year's
  // ratio; momentum comes from the actual year-over-year movement across those same
  // three years -- both replacing the old independent trend/grade source.
  const historicalGrade = computeHistoricalGrade(lossRatioHistory.threeYearLossRatio)
  const historicalMomentum = computeHistoricalMomentum(lossRatioTrend)

  const worsening = lossRatioTrend[2] > lossRatioTrend[1] && lossRatioTrend[1] > lossRatioTrend[0]
  // Watch: the 3-cycle loss-ratio trend is worsening but that hasn't (yet) moved the grade this cycle.
  const trendWatch = worsening && historicalMomentum === 'stable'

  // Renewal economics: the renewal-year figure is the same real premium shown in
  // Identity & Context (policy.premium), not an independently generated number -- these
  // used to be two disconnected values that happened to both be called "premium." The
  // expiring-year figure is derived by reversing the synthesized movement percentage off
  // that real base, the same way lossRatio/claimsPaid were made internally consistent above.
  const movementPercent = Math.round((rand() * 30 - 10) * 10) / 10
  // Not rounded when sourced from the real policy.premium -- rounding here would make
  // this figure and Identity & Context's Premium field merely *close*, not identical,
  // for any premium with cents. The expiring-year figure is still a synthesized
  // estimate, so it's fine to round.
  const renewalPremium = policy.premium != null && policy.premium > 0 ? policy.premium : Math.round(20000 + rand() * 80000)
  const expiringPremium = Math.round(renewalPremium / (1 + movementPercent / 100))

  return {
    verified,
    operational: {
      grade: operationalGrade,
      momentum: operationalMomentum,
      reason: `${operationalGrade}: ${operationalReason(policy)}`,
    },
    companyFinancial: companyFinancialGrade
      ? {
          grade: companyFinancialGrade,
          momentum: companyFinancialMomentum,
          reason: `${companyFinancialGrade}: ${companyFinancialReason(policy)}`,
        }
      : null,
    historical: {
      grade: historicalGrade,
      momentum: historicalMomentum,
      reason: historicalReason(historicalGrade, lossRatioTrend),
    },
    lossRatioHistory,
    lossRatioTrend,
    trendWatch,
    historicalPerformance: { lossRatio, claimsPaid, cumulativePremium, claimFrequency, tenureYears },
    renewalEconomics: { expiringPremium, renewalPremium, movementPercent },
  }
}

// A plain-language explanation of what's driving this cycle's rating -- surfaced as
// right-aligned subtext next to the "Risk Assessment" title. Same underlying logic as
// the old computeRecommendation (any C or 2+ dimensions downgraded is worth calling
// out first; otherwise any B or a trend watch; otherwise all-clear), but purely
// descriptive -- no action directive (no "Escalate"/"Renew as standard"/"Auto-renew"
// prefix, no suggested status) now that the Risk Quality section is information-only.
export function describeRating(rq: RiskQuality): string {
  const dims: Array<{ label: string; grade: Grade; momentum: Momentum }> = [
    { label: 'Operational', grade: rq.operational.grade, momentum: rq.operational.momentum },
  ]
  if (rq.companyFinancial) dims.push({ label: 'Company & Financial', grade: rq.companyFinancial.grade, momentum: rq.companyFinancial.momentum })
  dims.push({ label: 'Historical Performance', grade: rq.historical.grade, momentum: rq.historical.momentum })

  const suffix = rq.companyFinancial ? '' : ' Company & Financial is not yet graded (Unverified).'

  const cDims = dims.filter((d) => d.grade === 'C')
  const downgraded = dims.filter((d) => d.momentum === 'down')

  if (cDims.length > 0 || downgraded.length >= 2) {
    const reason =
      cDims.length > 0
        ? `${cDims.map((d) => d.label).join(' and ')} graded C`
        : `${downgraded.map((d) => d.label).join(' and ')} downgraded this cycle`
    return `${reason}.${suffix}`
  }

  const bDims = dims.filter((d) => d.grade === 'B')
  const moved = dims.filter((d) => d.momentum !== 'stable')
  if (bDims.length > 0 || rq.trendWatch) {
    const bits: string[] = []
    if (bDims.length > 0) bits.push(`${bDims.map((d) => d.label).join(' and ')} graded B`)
    if (moved.length > 0) bits.push(moved.map((d) => `${d.label} trending ${d.momentum}`).join(', '))
    if (rq.trendWatch) bits.push('Historical trend worsening (watch)')
    return `${bits.join('; ')}.${suffix}`
  }

  return `All dimensions graded A with no downgrades this cycle.${suffix}`
}
