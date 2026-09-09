export type Grade = 'A' | 'B' | 'C'

// `details` is a list of short lines for the card's tooltip -- the specific fired
// flags for Operational/Company & Financial, or a loss-ratio summary line for
// Historical Performance. Rendered as a <ul>, never comma-joined (2026-09-09 --
// momentum was removed from this type entirely; nothing else in the app consumed it,
// so it isn't kept around as a dead field).
export type DimensionGrade = { grade: Grade; details: string[] }

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
  dnbListedCompany: boolean
}

// One year of loss-ratio history, oldest -> newest. The newest year is the current,
// in-progress policy year (the term ending at renewalDate) -- premiumEarned for it is
// pro-rated by months elapsed; every earlier year is complete, so its premiumEarned
// equals premiumWritten exactly.
export type LossRatioYear = {
  year: number
  premiumWritten: number
  premiumEarned: number
  claimsIncurred: number
  claimsCount: number
}

// A cumulative nested window over the trailing N years (1/2/3/All), narrowest to
// widest. lossRatio is always claimsIncurred / premiumEarned for THIS window's own
// cumulative figures -- recomputed from the two rows it sits above, never an
// independent draw, so it can never drift from what they divide out to.
export type LossRatioWindow = {
  label: string
  premiumWritten: number
  premiumEarned: number
  claimsIncurred: number
  claimsCount: number
  lossRatio: number
}

export type LossRatioHistory = {
  years: LossRatioYear[] // 5, oldest -> newest
  oneYear: LossRatioWindow
  twoYear: LossRatioWindow
  threeYear: LossRatioWindow
  allYears: LossRatioWindow
}

export type RiskQuality = {
  verified: boolean
  operational: DimensionGrade
  // null when Unverified — Company & Financial is only calculated once Data Confidence
  // is Verified, same gating as the real methodology this prototypes.
  companyFinancial: DimensionGrade | null
  // Still mocked: no real prior-cycle claims trajectory data exists yet.
  historical: DimensionGrade
  // The data foundation for the Loss Ratio section's cumulative-window table -- also
  // what the Historical grade (above) is computed from (the All Years window).
  lossRatioHistory: LossRatioHistory
  // Policy tenure -- the last thing the old Historical Performance section carried
  // once its other figures (loss ratio/claims paid/cumulative premium/claim
  // frequency) were superseded by the Loss Ratio section, 2026-09-09. Lives in
  // Identity & Context now, not its own section.
  policyTenureYears: number
  renewalEconomics: {
    expiringPremium: number
    renewalPremium: number
    movementPercent: number
  }
}

// Data Confidence: Verified unless D&B couldn't match the company or shows it inactive.
// This is the ONLY definition of "verified" in the app (2026-09-09) -- a separate,
// narrower Data-Verified-pill rule (dnbNoMatch alone) existed briefly in the UI layer
// and was removed along with the pill itself; computeDataConfidence's two-flag rule is
// what the Company & Financial grade gate has always used, and is now the single source
// of truth for what "Unverified" means anywhere in this panel.
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

// Company & Financial grade, from the real Stage 2 flags -- D&B Listed Company counts
// alongside the other three (same tier, same threshold rule), derived straight from
// the four boolean fields rather than the stored stage2FlagCount column, which predates
// this field counting here and would undercount.
export function computeCompanyFinancialGrade(policy: RiskQualityInput): Grade {
  const flags = [policy.dnbRatingBelowA, policy.latestProfitNegative, policy.assetsMovedSignificant, policy.dnbListedCompany]
  const firedCount = flags.filter(Boolean).length
  if (firedCount >= 2) return 'C'
  if (firedCount === 1) return 'B'
  return 'A'
}

// Fired-flag labels for the Operational grade's tooltip, as a list -- not a
// comma-joined string (2026-09-09). Same labels used in FlagDetailPanel/FlagRow, so
// this never contradicts the flags shown elsewhere.
function operationalDetails(policy: RiskQualityInput): string[] {
  const fired: string[] = []
  if (policy.openClaim) fired.push('Open Claim')
  if (policy.premiumUnpaid) fired.push('Premium Unpaid')
  if (policy.renewalTypeManual) fired.push('Renewal Type Manual')
  if (policy.systemListedCompany) fired.push('System Listed Company')
  return fired.length > 0 ? fired : ['No flags fired']
}

// Fired-flag labels for the Company & Financial grade's tooltip. When Unverified, the
// grade itself is null and this is never called for the fired-flag case -- see
// companyFinancialUnverifiedDetails below for what the tooltip shows instead. An
// unexplained N/A is not acceptable now that the Data Verified pill (the only other
// hint) is gone (2026-09-09) -- the explanation has to live here.
function companyFinancialDetails(policy: RiskQualityInput): string[] {
  const fired: string[] = []
  if (policy.dnbRatingBelowA) fired.push('D&B Rating Below A')
  if (policy.latestProfitNegative) fired.push('Latest Profit Negative')
  if (policy.assetsMovedSignificant) fired.push('Assets Moved >25% YoY')
  if (policy.dnbListedCompany) fired.push('D&B Listed Company')
  return fired.length > 0 ? fired : ['No flags fired']
}

// Plain-language explanation for why Company & Financial is N/A, naming the specific
// D&B condition(s) responsible -- computeDataConfidence's own two-flag rule, so this
// can never disagree with the gate that actually suppressed the grade.
function companyFinancialUnverifiedDetails(policy: RiskQualityInput): string[] {
  if (policy.dnbNoMatch && policy.dnbStatusInactive) {
    return ['Not graded: D&B returned no match for this company, and shows it as inactive.']
  }
  if (policy.dnbNoMatch) {
    return ['Not graded: D&B returned no match for this company.']
  }
  return ['Not graded: D&B shows this company as inactive.']
}

// Historical grade, thresholded off a loss ratio -- the same way
// computeOperationalGrade/computeCompanyFinancialGrade threshold off real flag counts.
// Fed the All Years cumulative window's loss ratio (LossRatioHistory.allYears.lossRatio),
// the widest available window, not a single year's figure.
// Thresholds are an assumption (mid-50s to low-60s loss ratio is a normal/healthy range
// for commercial P&C), matched to the shipped distribution (mean ~55%, SD ~17pt) so the
// split lands roughly where A/B/C should for this dataset -- easy to retune later.
export function computeHistoricalGrade(lossRatio: number): Grade {
  // Threshold on the rounded percentage rather than the raw fraction, so the grade band
  // can never disagree with the displayed Loss Ratio % right at a boundary (e.g. a raw
  // 54.96% displaying as "55%" while still grading as if it were under the B cutoff).
  const pct = Math.round(lossRatio * 100)
  if (pct > 75) return 'C'
  if (pct >= 55) return 'B'
  return 'A'
}

// One-line tooltip detail for the Historical grade, tied to the All Years window --
// still a list (of one line) for the same uniform-tooltip-rendering reason as the
// other two dimensions, even though there's only ever one line to show here.
function historicalDetails(allYears: LossRatioWindow): string[] {
  const pct = Math.round(allYears.lossRatio * 100)
  return [`All-years loss ratio: ${pct}%`]
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

const LOSS_RATIO_HISTORY_YEARS = 5

// The current, in-progress policy year -- the calendar year the renewal date itself
// falls in (the term ending at renewalDate is the one running right now). Distinct
// from the four YEARS BEFORE it, all of which are complete.
function currentPolicyYear(renewalDate: string | null): number {
  const fallbackYear = 2026
  if (!renewalDate) return fallbackYear
  const date = new Date(`${renewalDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return fallbackYear
  return date.getUTCFullYear()
}

// Builds 5 years of loss-ratio history (oldest -> newest), pinning the newest year's
// premiumWritten/claimsIncurred to the same seeded figures the panel has always used
// for "this cycle" (see getRiskQuality below) so nothing already-visible silently
// changes value -- only pro-rated for premiumEarned, per the current-year rule.
// The four prior years are synthesized backward from there: a plausible YoY premium
// trend for premiumWritten, and a bell-curve walk for the loss ratio (same shape the
// old 3-year version used, just carried one step further back each time), with each
// year's claimsIncurred then derived from that year's own premiumWritten and ratio --
// so every year's own figures are internally consistent by construction.
function buildLossRatioHistory(
  rand: () => number,
  renewalDate: string | null,
  currentPremiumWritten: number,
  currentClaimsIncurred: number
): LossRatioHistory {
  const newestYear = currentPolicyYear(renewalDate)
  // How far into the current policy year we are -- synthesized rather than read off
  // the real wall-clock date, so this stays a stable, per-policy-seeded figure like
  // everything else here (not something that would silently drift day to day).
  const monthsElapsed = 1 + Math.floor(rand() * 12)

  // Built newest -> oldest (index 0 = current year), reversed to oldest -> newest below.
  const written = [currentPremiumWritten]
  const claims = [currentClaimsIncurred]
  for (let i = 1; i < LOSS_RATIO_HISTORY_YEARS; i++) {
    const growth = Math.round((rand() * 30 - 10) * 10) / 10 // roughly -10%..+20% YoY
    const priorWritten = Math.round(written[i - 1] / (1 + growth / 100))
    written.push(priorWritten)

    const priorRatio = clamp(claims[i - 1] / written[i - 1] - (rand() - 0.5) * 0.24, 0.1, 1.4)
    claims.push(Math.round(priorRatio * priorWritten))
  }
  written.reverse()
  claims.reverse()

  const years: LossRatioYear[] = written.map((premiumWritten, i) => {
    const isCurrent = i === LOSS_RATIO_HISTORY_YEARS - 1
    const premiumEarned = isCurrent ? Math.round((premiumWritten * monthsElapsed) / 12) : premiumWritten
    return {
      year: newestYear - (LOSS_RATIO_HISTORY_YEARS - 1 - i),
      premiumWritten,
      premiumEarned,
      claimsIncurred: claims[i],
      claimsCount: 1 + Math.floor(rand() * 7),
    }
  })

  function buildWindow(count: number, label: string): LossRatioWindow {
    const slice = years.slice(years.length - count)
    const premiumWritten = slice.reduce((sum, y) => sum + y.premiumWritten, 0)
    const premiumEarned = slice.reduce((sum, y) => sum + y.premiumEarned, 0)
    const claimsIncurred = slice.reduce((sum, y) => sum + y.claimsIncurred, 0)
    const claimsCount = slice.reduce((sum, y) => sum + y.claimsCount, 0)
    return {
      label,
      premiumWritten,
      premiumEarned,
      claimsIncurred,
      claimsCount,
      lossRatio: premiumEarned > 0 ? claimsIncurred / premiumEarned : 0,
    }
  }

  return {
    years,
    oneYear: buildWindow(1, '1 Year (Earned)'),
    twoYear: buildWindow(2, '2 Years (Earned)'),
    threeYear: buildWindow(3, '3 Years (Earned)'),
    allYears: buildWindow(LOSS_RATIO_HISTORY_YEARS, 'All Years (Earned)'),
  }
}

// Assembles risk-quality data for a Manual Review policy. Data Confidence and the
// Operational / Company & Financial grades are computed from the policy's real flag
// data (see computeDataConfidence / computeOperationalGrade / computeCompanyFinancialGrade
// above). Everything else here has no real data source yet, so it's mocked, deterministic
// per policy id: the Historical grade and its loss-ratio history, policy tenure, and the
// renewal financials figures.
export function getRiskQuality(policy: RiskQualityInput): RiskQuality {
  const rand = mulberry32(hashSeed(policy.id))

  const verified = computeDataConfidence(policy)
  const operationalGrade = computeOperationalGrade(policy)
  const companyFinancialGrade = verified ? computeCompanyFinancialGrade(policy) : null

  // Seed figures for the current (newest) loss-ratio-history year, from a bell curve
  // centered on a plausible commercial P&C target (60% mean, 15pt SD -- an assumption,
  // easy to retune since this is mocked), clamped to a realistic range.
  const seedLossRatio = clamp(randNormal(rand, 0.6, 0.15), 0.15, 1.3)
  const currentPremiumWritten = Math.round(50000 + rand() * 200000)
  const currentClaimsIncurred = Math.round(seedLossRatio * currentPremiumWritten)
  const policyTenureYears = 1 + Math.floor(rand() * 12)

  const lossRatioHistory = buildLossRatioHistory(rand, policy.renewalDate, currentPremiumWritten, currentClaimsIncurred)
  const historicalGrade = computeHistoricalGrade(lossRatioHistory.allYears.lossRatio)

  // Renewal financials: the renewal-year figure is the same real premium shown in
  // Identity & Context (policy.premium), not an independently generated number -- these
  // used to be two disconnected values that happened to both be called "premium." The
  // expiring-year figure is derived by reversing the synthesized movement percentage off
  // that real base, the same way currentClaimsIncurred was made internally consistent above.
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
      details: operationalDetails(policy),
    },
    companyFinancial: companyFinancialGrade
      ? {
          grade: companyFinancialGrade,
          details: companyFinancialDetails(policy),
        }
      : null,
    historical: {
      grade: historicalGrade,
      details: historicalDetails(lossRatioHistory.allYears),
    },
    lossRatioHistory,
    policyTenureYears,
    renewalEconomics: { expiringPremium, renewalPremium, movementPercent },
  }
}

// Tooltip details for a null (Unverified) Company & Financial grade -- kept separate
// from getRiskQuality's companyFinancial assembly above so the UI layer can call it
// without re-deriving the verified check itself. Exported since RiskQualityPanel needs
// it precisely when riskQuality.companyFinancial is null (§5.4).
export function unverifiedCompanyFinancialDetails(policy: RiskQualityInput): string[] {
  return companyFinancialUnverifiedDetails(policy)
}
