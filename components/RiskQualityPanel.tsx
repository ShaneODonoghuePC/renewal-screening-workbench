'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatCurrency, formatCompactCurrency, EMPTY_VALUE } from '@/lib/format'
import { getRiskQuality, computeRecommendation, computeHistoricalGrade, type Grade, type Momentum } from '@/lib/mockRiskQuality'
import FlagDetailPanel, { type FlagEvidence } from '@/components/FlagDetailPanel'
import SeverityBadge from '@/components/SeverityBadge'

type PolicyDetail = FlagEvidence & {
  id: string
  country: string
  customerName: string
  customerIdentifier: string
  brokerName: string
  renewalDate: string | null
  premium: number | null
  stage1FlagCount: number
  stage2FlagCount: number
  routing: string | null
  attention: string | null
  flagReasons: string | null
}

// Full RAG treatment for the graded dimensions: A = green, B = amber, C = red. Amber
// rather than orange for the middle tier -- more visually distinct from red at a glance.
function gradeBadgeClasses(grade: Grade) {
  if (grade === 'C') return 'bg-red-600 text-white'
  if (grade === 'B') return 'bg-amber-600 text-white'
  return 'bg-green-600 text-white'
}

function momentumSymbol(momentum: Momentum) {
  if (momentum === 'up') return '↑'
  if (momentum === 'down') return '↓'
  return '→'
}

// Same RAG bands as the grade badges, softer card treatment (border/bg-50/text-700).
// Grade A uses the sage accent rather than green here -- the grade-A badge circle
// itself stays green-600 for RAG legibility, this is just the card's tint.
function ragCardClasses(grade: Grade) {
  if (grade === 'C') return 'border-red-200 bg-red-50 text-red-700'
  if (grade === 'B') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-sage-300 bg-sage-100 text-sage-800'
}

// Worst-of-three across the graded dimensions (Company & Financial excluded from the
// array entirely while Unverified, same as computeRecommendation) -- this is what colors
// the whole Risk Quality section container, so one B among otherwise-A grades still
// reads as amber at a glance, not just on that one card.
function worstGrade(grades: Grade[]): Grade {
  if (grades.includes('C')) return 'C'
  if (grades.includes('B')) return 'B'
  return 'A'
}

// Border/bg only (no text color) so this can wrap the whole section without overriding
// the slate text colors already set on its children. Grade A -- the best-grade case --
// gets the sage accent tint per the brand's small-footprint-accent rule; the grade
// badges inside stay green-600 regardless, so they read clearly against the sage bg.
function riskQualitySectionClasses(grade: Grade) {
  if (grade === 'C') return 'border-red-300 bg-red-50'
  if (grade === 'B') return 'border-amber-300 bg-amber-50'
  return 'border-sage-300 bg-sage-50'
}

function verifiedPillClasses(verified: boolean) {
  return verified ? 'border-green-300 bg-green-50 text-green-700' : 'border-amber-300 bg-amber-50 text-amber-700'
}

// Tiny inline trajectory display for the 3-cycle D&B score history — no charting
// dependency needed for three points.
function Sparkline({ values }: { values: [number, number, number] }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values.map((v, i) => `${i * 18},${18 - ((v - min) / range) * 18}`).join(' ')
  return (
    <svg width="40" height="20" viewBox="-2 -2 40 22" className="text-slate-400" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function GradeCard({
  label,
  scaleInfo,
  grade,
  momentum,
  reason,
  watch,
  history,
}: {
  label: string
  scaleInfo: string
  grade: Grade | null
  momentum: Momentum
  reason?: string
  watch?: boolean
  history?: [number, number, number]
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
          {label}
          <span
            className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-slate-300 text-[9px] font-semibold leading-none text-slate-400"
            title={scaleInfo}
            aria-label={`What ${label} grades mean: ${scaleInfo}`}
          >
            i
          </span>
        </p>
        {grade && (
          <span
            className={`text-sm ${momentum === 'down' ? 'text-brand' : 'text-slate-400'}`}
            aria-label={`Momentum: ${momentum}`}
            title={`Momentum: ${momentum}`}
          >
            {momentumSymbol(momentum)}
          </span>
        )}
      </div>
      {/* Grade circle centered horizontally (middle of a 1fr/auto/1fr grid); the
          sparkline sits in the right-hand column, just to the right of the circle --
          acceptable for the circle+sparkline pair to look a little off-center as a
          whole, only the circle itself needs to be centered. */}
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center">
        <span aria-hidden="true" />
        {grade ? (
          <span
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-lg font-bold ${gradeBadgeClasses(grade)}`}
          >
            {grade}
          </span>
        ) : (
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs font-medium text-slate-400">
            N/A
          </span>
        )}
        <span className="pl-2">{history && <Sparkline values={history} />}</span>
      </div>
      {reason && <p className="mt-2 text-xs text-slate-500">{reason}</p>}
      {!grade && <p className="mt-2 text-xs text-slate-500">Not yet graded: Unverified.</p>}
      {watch && (
        <span className="mt-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          Watch: worsening trend
        </span>
      )}
    </div>
  )
}

function formatDate(renewalDate: string | null) {
  if (!renewalDate) return EMPTY_VALUE
  const date = new Date(`${renewalDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// Expiring/renewal years for the Renewal economics line -- there's no separate stored
// "expiring premium year," so it's derived as the year before the renewal date's year,
// same cycle-to-cycle relationship the expiring vs. renewal premium figures represent.
function renewalYears(renewalDate: string | null): { expiringYear: string; renewalYear: string } {
  if (!renewalDate) return { expiringYear: EMPTY_VALUE, renewalYear: EMPTY_VALUE }
  const date = new Date(`${renewalDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return { expiringYear: EMPTY_VALUE, renewalYear: EMPTY_VALUE }
  const renewalYear = date.getUTCFullYear()
  return { expiringYear: String(renewalYear - 1), renewalYear: String(renewalYear) }
}

// Risk Quality Panel for a Manual Review policy: identity/context, Stage 1/2 flags,
// derived fields, graded dimensions + computed recommendation, historical performance.
// Read-only -- status/assignment/comments/activity live in the separate Underwriter
// Workspace (components/UnderwriterWorkspace.tsx), reached via the table's expand row.
// Shared by the standalone /review/manual/[id] page and Assignment & Management's
// "Review" slide-out -- same data, just different surrounding chrome.
export default function RiskQualityPanel({ policyId }: { policyId: string }) {
  const [policy, setPolicy] = useState<PolicyDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadPolicy = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const encodedId = encodeURIComponent(policyId)
      const policyRes = await fetch(`/api/policies/${encodedId}`, { credentials: 'include' })

      if (policyRes.status === 401) {
        setError('Pick an identity from "Acting as" above to view this policy.')
        return
      }
      if (policyRes.status === 403) {
        setError('This policy belongs to a different country than your acting-as session.')
        return
      }
      if (policyRes.status === 404) {
        setError('Policy not found.')
        return
      }
      if (!policyRes.ok) {
        setError('Unable to load this policy.')
        return
      }

      setPolicy(await policyRes.json())
    } catch {
      setError('Unable to load this policy. Check your connection.')
    } finally {
      setLoading(false)
    }
  }, [policyId])

  useEffect(() => {
    loadPolicy()
  }, [loadPolicy])

  if (error) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">{error}</div>
  }

  if (!policy) {
    return <div className="p-6 text-sm text-slate-500">{loading ? 'Loading…' : 'No data.'}</div>
  }

  // Data Confidence and the Operational / Company & Financial grades are derived from
  // policy's real flag data; Historical and the figures below stay mocked (see
  // lib/mockRiskQuality.ts for exactly which parts are real vs. still simulated).
  const riskQuality = getRiskQuality(policy)
  const recommendation = computeRecommendation(riskQuality)
  const dnbVerified = !policy.dnbNoMatch
  const sectionGradeInputs: Grade[] = [riskQuality.operational.grade, riskQuality.historical.grade]
  if (riskQuality.companyFinancial) sectionGradeInputs.push(riskQuality.companyFinancial.grade)
  const sectionGrade = worstGrade(sectionGradeInputs)
  const { expiringYear, renewalYear } = renewalYears(policy.renewalDate)

  return (
    <div className="space-y-6">
      {/* Identity & Context -- the old hero section (policy ID/customer name in a grey
          box up top) duplicated fields already itemized here, so it's gone; the Verified
          pill and Attention badge it used to carry moved down into this section's own
          header row instead. */}
      <section className="border-b border-slate-200 pb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Identity &amp; Context</h2>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${verifiedPillClasses(dnbVerified)}`}>
              {dnbVerified ? 'Data Verified (D&B match found)' : 'Data Not Verified (D&B No Match)'}
            </span>
            <SeverityBadge attention={policy.attention} />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-500">Policy number</dt><dd className="font-medium text-slate-900">{policy.id}</dd></div>
          <div><dt className="text-slate-500">Customer name</dt><dd className="font-medium text-slate-900">{policy.customerName}</dd></div>
          <div><dt className="text-slate-500">Customer identifier</dt><dd className="font-medium text-slate-900">{policy.customerIdentifier}</dd></div>
          <div><dt className="text-slate-500">Broker name</dt><dd className="font-medium text-slate-900">{policy.brokerName}</dd></div>
          <div><dt className="text-slate-500">End date</dt><dd className="font-medium text-slate-900">{formatDate(policy.renewalDate)}</dd></div>
          <div><dt className="text-slate-500">Currency</dt><dd className="font-medium text-slate-900">{policy.currency || EMPTY_VALUE}</dd></div>
          <div><dt className="text-slate-500">Premium</dt><dd className="font-medium text-slate-900">{formatCurrency(policy.premium, policy.currency)}</dd></div>
        </dl>
      </section>

      {/* Risk Quality Panel -- Data Confidence and Operational/Company & Financial grades
          are derived from real flag data; Historical and the figures below are still mocked.
          Section stays boxed (unlike the report-style sections around it) specifically so
          the worst-of-three grade coloring below means something. */}
      <section className={`rounded-lg border p-4 shadow-sm ${riskQualitySectionClasses(sectionGrade)}`}>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Risk Quality</h2>

        {!riskQuality.verified && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Data confidence is Unverified (D&amp;B No Match or D&amp;B Status Inactive), so Company &amp; Financial
            grading is not yet calculated.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <GradeCard
            label="Operational"
            scaleInfo="A = no Stage 1 flags fired. B = exactly one non-critical flag. C = Open Claim, Premium Unpaid, or 2+ flags fired."
            grade={riskQuality.operational.grade}
            momentum={riskQuality.operational.momentum}
            reason={riskQuality.operational.reason}
          />
          <GradeCard
            label="Company & Financial"
            scaleInfo="A = no Stage 2 flags fired. B = exactly one flag. C = two or more of D&B Rating Below A, Latest Profit Negative, or Assets Moved >25% YoY."
            grade={riskQuality.companyFinancial?.grade ?? null}
            momentum={riskQuality.companyFinancial?.momentum ?? 'stable'}
            reason={riskQuality.companyFinancial?.reason}
          />
          <GradeCard
            label="Historical"
            scaleInfo="Reflects historical claims performance. A persistent loss-ratio increase raises a Watch flag even before the letter grade changes."
            grade={riskQuality.historical.grade}
            momentum={riskQuality.historical.momentum}
            reason={riskQuality.historical.reason}
            watch={riskQuality.trendWatch}
            history={riskQuality.lossRatioTrend}
          />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Renewal economics</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {formatCurrency(riskQuality.renewalEconomics.expiringPremium, policy.currency)} ({expiringYear})
              {' → '}
              {formatCurrency(riskQuality.renewalEconomics.renewalPremium, policy.currency)} ({renewalYear})
            </p>
            <p className={`mt-1 text-xs font-medium ${riskQuality.renewalEconomics.movementPercent >= 0 ? 'text-brand' : 'text-slate-600'}`}>
              {riskQuality.renewalEconomics.movementPercent >= 0 ? '+' : ''}
              {riskQuality.renewalEconomics.movementPercent}% change
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Computed recommendation</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{recommendation.text}</p>
          </div>
        </div>
      </section>

      {/* Stage 1/2 flags, plus Flag Reasons as a closing line -- the only place the
          four attention-only signals (Data Incomplete, D&B Predictor Concern, D&B
          Significant Event, D&B Listed Status Unknown) are visible, since those don't
          get their own Y/N row above. The rest of the old "Derived" section (Stage 1/2
          counts, Routing, Attention) was redundant with the flags above, the Attention
          badge in the header, and the fact this panel is only ever reached for Manual
          Review policies -- removed rather than kept as dead weight. */}
      <section className="border-b border-slate-200 pb-6">
        <FlagDetailPanel item={policy} />
        <div className="mt-4">
          <dt className="text-sm text-slate-500">Flag Reasons</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">{policy.flagReasons || EMPTY_VALUE}</dd>
        </div>
      </section>

      {/* Historical Performance — mocked, does not affect grade */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Historical Performance</h2>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div
            className={`flex h-full min-w-0 flex-col justify-between rounded-md border p-4 ${ragCardClasses(
              computeHistoricalGrade(riskQuality.historicalPerformance.lossRatio)
            )}`}
          >
            <p className="text-xs font-medium opacity-75">Loss ratio</p>
            <p className="whitespace-nowrap text-xl font-semibold">{Math.round(riskQuality.historicalPerformance.lossRatio * 100)}%</p>
          </div>
          <div className="flex h-full min-w-0 flex-col justify-between rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Claims paid</p>
            <p className="whitespace-nowrap text-lg font-semibold text-slate-900" title={formatCurrency(riskQuality.historicalPerformance.claimsPaid, policy.currency)}>
              {formatCompactCurrency(riskQuality.historicalPerformance.claimsPaid, policy.currency)}
            </p>
          </div>
          <div className="flex h-full min-w-0 flex-col justify-between rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Cumulative premium</p>
            <p className="whitespace-nowrap text-lg font-semibold text-slate-900" title={formatCurrency(riskQuality.historicalPerformance.cumulativePremium, policy.currency)}>
              {formatCompactCurrency(riskQuality.historicalPerformance.cumulativePremium, policy.currency)}
            </p>
          </div>
          <div className="flex h-full min-w-0 flex-col justify-between rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Claim frequency</p>
            <p className="whitespace-nowrap text-xl font-semibold text-slate-900">
              {riskQuality.historicalPerformance.claimFrequency.toFixed(1)}/yr
            </p>
          </div>
          <div className="flex h-full min-w-0 flex-col justify-between rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Tenure</p>
            <p className="whitespace-nowrap text-xl font-semibold text-slate-900">{riskQuality.historicalPerformance.tenureYears} yrs</p>
          </div>
        </div>
      </section>
    </div>
  )
}
