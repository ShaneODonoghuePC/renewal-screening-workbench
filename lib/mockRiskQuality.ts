export type Grade = 'A' | 'B' | 'C'

// No `details` field (removed 2026-09-11) -- the per-card tooltips used to carry a
// fired-flag list or loss-ratio summary line here, but that's now redundant with the
// "Flags Raised" block (moved into the three-card section, SPEC.md S5.4) and was
// dropped from every tooltip. The one exception -- the Company & Financial N/A
// explanation -- isn't a DimensionGrade at all (that dimension is `null` when
// Unverified); see unverifiedCompanyFinancialDetails below, called directly by
// RiskQualityPanel only in that null case.
export type DimensionGrade = { grade: Grade }

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
  // Consolidated-accounts trio (2026-09-11, SPEC.md S3.3). consolidatedAccounts is pure
  // context (not consumed by computeCompanyFinancialGrade below) -- present here only so
  // callers can pass one policy object through. The other two DO score.
  consolidatedAccounts: boolean
  latestConsolidatedProfitNegative: boolean
  consolidatedAssetsMovedSignificant: boolean
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

// Data Confidence: Verified unless D&B couldn't match the company. D&B Status Inactive
// was folded into computeCompanyFinancialGrade as a fifth scoring flag on 2026-09-10 --
// D&B DID return a match for an inactive company, so there is a finding to grade, unlike
// No Match where there is nothing D&B reported at all. computeDataConfidence's one-flag
// rule is what the Company & Financial grade gate has always used, and is now the single
// source of truth for what "Unverified" means anywhere in this panel.
export function computeDataConfidence(policy: RiskQualityInput): boolean {
  return !policy.dnbNoMatch
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

// Company & Financial grade, from the real Stage 2 flags -- D&B Listed Company and D&B
// Status Inactive (added 2026-09-10), then Latest Consolidated Profit Negative and
// Consolidated Assets Moved >25% YoY (added 2026-09-11) count alongside the other three
// (same tier, same threshold rule) -- seven flags now, not four. Consolidated Accounts
// itself does NOT count (pure context, SPEC.md S3.3). Derived straight from the boolean
// fields rather than the stored stage2FlagCount column, which predates this field
// counting here and would undercount.
export function computeCompanyFinancialGrade(policy: RiskQualityInput): Grade {
  const flags = [
    policy.dnbStatusInactive,
    policy.dnbRatingBelowA,
    policy.latestProfitNegative,
    policy.assetsMovedSignificant,
    policy.dnbListedCompany,
    policy.latestConsolidatedProfitNegative,
    policy.consolidatedAssetsMovedSignificant,
  ]
  const firedCount = flags.filter(Boolean).length
  if (firedCount >= 2) return 'C'
  if (firedCount === 1) return 'B'
  return 'A'
}

// Plain-language explanation for why Company & Financial is N/A. computeDataConfidence's
// gate is now dnbNoMatch alone (2026-09-10), so this is only ever called for that one
// reason -- can never disagree with the gate that actually suppressed the grade.
function companyFinancialUnverifiedDetails(policy: RiskQualityInput): string[] {
  return ['Not graded: D&B returned no match for this company.']
}

// Historical grade bands -- the ONE place these numbers are written down (2026-09-10).
// Every consumer (the grade computation below, the Historical card's tooltip text in
// RiskQualityPanel.tsx) reads this, rather than restating the numbers -- there was a
// real bug in this app's history where a loss-ratio cell used its own 25%/50% cutoffs
// while the grade beside it used 55/75, so the same policy could show a "green" cell
// and a C grade at the same time. Don't add a second definition anywhere; import this one.
//
// PROTOTYPE THRESHOLDS, chosen for this demo dataset -- NOT a production recommendation.
// Set 2026-09-10 against a right-skewed ~26%-of-policies-claim / ~20%-mean-among-claimants
// distribution (see buildLossRatioHistory below); the original 55/75 bands were set when
// the synthesis averaged ~60% and are unreachable once the book averages ~20%. Where the
// real production thresholds should land is a separate, open question -- the real build
// must not inherit these by default just because they're what the demo shipped with.
export const HISTORICAL_GRADE_BANDS = {
  // A: below this. B: from this up to (and including) bMaxPercent. C: above bMaxPercent.
  aMaxPercent: 35,
  bMaxPercent: 55,
} as const

// Historical grade, thresholded off a loss ratio -- the same way
// computeOperationalGrade/computeCompanyFinancialGrade threshold off real flag counts.
// Fed the All Years cumulative window's loss ratio (LossRatioHistory.allYears.lossRatio),
// the widest available window, not a single year's figure.
export function computeHistoricalGrade(lossRatio: number): Grade {
  // Threshold on the rounded percentage rather than the raw fraction, so the grade band
  // can never disagree with the displayed Loss Ratio % right at a boundary.
  const pct = Math.round(lossRatio * 100)
  if (pct > HISTORICAL_GRADE_BANDS.bMaxPercent) return 'C'
  if (pct >= HISTORICAL_GRADE_BANDS.aMaxPercent) return 'B'
  return 'A'
}

// The Historical card's tooltip description, generated from the same bands the grade
// computation uses -- never a separately-typed set of strings that could drift from
// them. One line per band (2026-09-10, was a single sentence), matching the other two
// cards' scaleInfo shape -- HISTORICAL_GRADE_BANDS stays the one place the numbers
// themselves are written down; only the rendering here changed.
export function historicalGradeScaleInfo(): string[] {
  const { aMaxPercent, bMaxPercent } = HISTORICAL_GRADE_BANDS
  return [
    `A = under ${aMaxPercent}% loss ratio (All Years).`,
    `B = ${aMaxPercent}-${bMaxPercent}%.`,
    `C = over ${bMaxPercent}%.`,
  ]
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

// Policy-level claim distribution (2026-09-10, confirmed with the client): ~26% of
// POLICIES carry any claims at all -- drawn once per policy, not once per year, so a
// clean policy is clean across every year (zero claims incurred, zero claims count,
// 0% loss ratio everywhere) rather than almost every policy being "claiming somewhere"
// across five years. Among claiming policies, a claim doesn't hit every year either --
// each year independently has a chance of being one of the years with a claim, so the
// normal case is claims in some years and not others, not all five.
//
// CLAIMING_POLICY_RATE is the per-policy draw probability, not the measured outcome --
// against this specific 403-row dataset (fixed ids, so not literally i.i.d.), 0.28
// lands the actual measured share at ~25.8%, empirically checked via
// scripts/_measure-lossratio.cjs rather than assumed equal to the input probability.
const CLAIMING_POLICY_RATE = 0.28
const CLAIMING_POLICY_YEAR_ACTIVE_RATE = 0.5

// Log-normal draw for a claiming year's own claims-to-written-premium ratio -- mu/sigma
// tuned empirically (scripts/_measure-lossratio.cjs) so that, once diluted by the ~50%
// of years in a claiming policy with no claim and rolled up into the All Years
// cumulative window, the resulting population of claiming policies averages close to
// the ~20% target (measured: 20.9%) while still carrying a real right-hand tail (some
// policies well past the Historical grade's B and C thresholds, HISTORICAL_GRADE_BANDS
// above) -- not a tight distribution that would put every policy in the A band
// regardless of whether it claims. No upper clamp: a log-normal tail can produce a
// genuinely large ratio for an unlucky year, and clamping it back down would undo the
// point of using a skewed distribution in the first place.
function drawClaimYearRatio(rand: () => number): number {
  const mu = -1.95
  const sigma = 1.3
  const z = randNormal(rand, 0, 1)
  return Math.exp(mu + sigma * z)
}

// Builds 5 years of loss-ratio history (oldest -> newest). premiumWritten follows a
// plausible YoY trend backward from the current year's own written premium (unrelated
// to whether the policy claims at all). claimsIncurred/claimsCount are decided by the
// policy-level claiming draw above -- an honest zero for a clean policy or a clean
// policy's non-claiming years, never floored or clamped away from zero (2026-09-10;
// this used to have a 0.1 floor on the ratio and a "1 +" floor on claimsCount, both of
// which made a genuinely clean year impossible).
//
// The newest year is the current, in-progress policy year: premiumEarned is pro-rated
// by months elapsed, and so, as of 2026-09-10, is claimsIncurred, on exactly the same
// basis -- claims accrue over the year just as premium does, so pro-rating one and not
// the other (the earlier bug) inflated that year's ratio by up to 12x. No flooring
// monthsElapsed and no clamping the result; the range is left to fall where it falls.
function buildLossRatioHistory(rand: () => number, renewalDate: string | null, currentPremiumWritten: number): LossRatioHistory {
  const newestYear = currentPolicyYear(renewalDate)
  // How far into the current policy year we are -- synthesized rather than read off
  // the real wall-clock date, so this stays a stable, per-policy-seeded figure like
  // everything else here (not something that would silently drift day to day).
  const monthsElapsed = 1 + Math.floor(rand() * 12)

  // Premium trend: built newest -> oldest (index 0 = current year), reversed below.
  const written = [currentPremiumWritten]
  for (let i = 1; i < LOSS_RATIO_HISTORY_YEARS; i++) {
    const growth = Math.round((rand() * 30 - 10) * 10) / 10 // roughly -10%..+20% YoY
    written.push(Math.round(written[i - 1] / (1 + growth / 100)))
  }
  written.reverse()

  // Claims: one policy-level draw, then (for claiming policies only) one per-year
  // activation draw, both BEFORE the ratio/count draws below -- so which years end up
  // active doesn't depend on how many random calls a given year's magnitude ends up
  // consuming, and the sequence stays the same length regardless of outcome.
  const isClaimingPolicy = rand() < CLAIMING_POLICY_RATE
  // `written` is already oldest -> newest at this point (reversed above), so index
  // length-1 is the current year -- matters for the fallback below.
  const yearActive = written.map(() => isClaimingPolicy && rand() < CLAIMING_POLICY_YEAR_ACTIVE_RATE)
  if (isClaimingPolicy && !yearActive.some(Boolean)) {
    // A "claiming policy" with zero active years by chance (all five draws missed) --
    // force the current (newest) year active rather than silently having a claiming
    // policy that never actually shows a claim anywhere.
    yearActive[yearActive.length - 1] = true
  }
  const claimsRaw = written.map((premiumWritten, i) => {
    if (!yearActive[i]) return { claimsIncurred: 0, claimsCount: 0 }
    const ratio = drawClaimYearRatio(rand)
    return { claimsIncurred: Math.round(ratio * premiumWritten), claimsCount: 1 + Math.floor(rand() * 3) }
  })

  const years: LossRatioYear[] = written.map((premiumWritten, i) => {
    const isCurrent = i === LOSS_RATIO_HISTORY_YEARS - 1
    const premiumEarned = isCurrent ? Math.round((premiumWritten * monthsElapsed) / 12) : premiumWritten
    // Pro-rate the current year's claims on the same basis as its premium (the fix) --
    // a genuinely zero year (not active) stays exactly zero either way.
    const claimsIncurred = isCurrent ? Math.round((claimsRaw[i].claimsIncurred * monthsElapsed) / 12) : claimsRaw[i].claimsIncurred
    return {
      year: newestYear - (LOSS_RATIO_HISTORY_YEARS - 1 - i),
      premiumWritten,
      premiumEarned,
      claimsIncurred,
      claimsCount: claimsRaw[i].claimsCount,
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

  // Exposure size for the current policy year -- unrelated to whether the policy
  // claims at all (that's decided inside buildLossRatioHistory, at the policy level).
  const currentPremiumWritten = Math.round(50000 + rand() * 200000)
  const policyTenureYears = 1 + Math.floor(rand() * 12)

  const lossRatioHistory = buildLossRatioHistory(rand, policy.renewalDate, currentPremiumWritten)
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
    operational: { grade: operationalGrade },
    companyFinancial: companyFinancialGrade ? { grade: companyFinancialGrade } : null,
    historical: { grade: historicalGrade },
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
