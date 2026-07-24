'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatCurrency, formatCompactCurrency, EMPTY_VALUE } from '@/lib/format'
import { getRiskQuality, describeRating, type Grade, type Momentum } from '@/lib/mockRiskQuality'
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

// Plain Unicode arrows (↑ ↓ →) rendered visibly inconsistently across directions --
// different glyph weights/widths/baselines depending on the font's own arrow metrics.
// Same stroke-icon convention as SettingsMenu's gear (viewBox 24x24, stroke=currentColor,
// strokeWidth 2, round caps/joins) so this reads as one deliberate icon set rather than
// a one-off. Fixed h-3.5 w-3.5 box -- same footprint as the info icon's circle next to
// it -- so all three grade cards' arrows sit in an identical, vertically centered slot
// regardless of which direction they're showing.
function MomentumArrow({ momentum }: { momentum: Momentum }) {
  const points = momentum === 'up' ? '5 12 12 5 19 12' : momentum === 'down' ? '19 12 12 19 5 12' : '12 5 19 12 12 19'
  const line =
    momentum === 'up'
      ? { x1: 12, y1: 19, x2: 12, y2: 5 }
      : momentum === 'down'
        ? { x1: 12, y1: 5, x2: 12, y2: 19 }
        : { x1: 5, y1: 12, x2: 19, y2: 12 }
  return (
    <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
        <polyline points={points} />
      </svg>
    </span>
  )
}

// Worst-of-three across the graded dimensions (Company & Financial excluded from the
// array entirely while Unverified, same as describeRating) -- this is what colors
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

// Tiny inline trajectory display -- no charting dependency needed for three points.
// Used for the 3 Year Loss Ratio sparkline in Renewal Economics (moved here from the
// Historical Performance grade card, which no longer carries one).
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
}: {
  label: string
  scaleInfo: string
  grade: Grade | null
  momentum: Momentum
  reason?: string
  watch?: boolean
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
            className={momentum === 'down' ? 'text-brand' : 'text-slate-400'}
            aria-label={`Momentum: ${momentum}`}
            title={`Momentum: ${momentum}`}
          >
            <MomentumArrow momentum={momentum} />
          </span>
        )}
      </div>
      <div className="mt-2 flex justify-center">
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

// Single label-left/value-right row, used throughout Identity & Context and Renewal
// Economics -- tight py-1 spacing (vs. the old 2-col grid's gap-4) per the new layout.
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  )
}

function formatDate(renewalDate: string | null) {
  if (!renewalDate) return EMPTY_VALUE
  const date = new Date(`${renewalDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// Expiring/renewal years for the Renewal Economics line -- there's no separate stored
// "expiring premium year," so it's derived as the year before the renewal date's year,
// same cycle-to-cycle relationship the expiring vs. renewal premium figures represent.
function renewalYears(renewalDate: string | null): { expiringYear: string; renewalYear: string } {
  if (!renewalDate) return { expiringYear: EMPTY_VALUE, renewalYear: EMPTY_VALUE }
  const date = new Date(`${renewalDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return { expiringYear: EMPTY_VALUE, renewalYear: EMPTY_VALUE }
  const renewalYear = date.getUTCFullYear()
  return { expiringYear: String(renewalYear - 1), renewalYear: String(renewalYear) }
}

// Risk Assessment panel for a Manual Review policy: identity/context + renewal economics
// side by side, Risk Quality (information-only grade boxes) + Flag Reasons, the detailed
// flag breakdown, and Historical Performance (mini-metrics + the 3-Yr Loss Ratio table).
// Read-only -- status/assignment/comments/activity live in the separate Underwriter
// Workspace (components/UnderwriterWorkspace.tsx), reached via the table's expand row.
// Shared by the standalone /review/manual/[id] page and Renewal Management's
// "Review" slide-out -- same data, just different surrounding chrome. Both host contexts
// leave title rendering entirely to this component now, since the rating-explanation
// subtext has to sit inline next to the "Risk Assessment" title, not floating separately
// in whatever header bar the host happens to provide.
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
  // policy's real flag data; Historical Performance and the figures below stay mocked
  // (see lib/mockRiskQuality.ts for exactly which parts are real vs. still simulated).
  const riskQuality = getRiskQuality(policy)
  const ratingExplanation = describeRating(riskQuality)
  const dnbVerified = !policy.dnbNoMatch
  const sectionGradeInputs: Grade[] = [riskQuality.operational.grade, riskQuality.historical.grade]
  if (riskQuality.companyFinancial) sectionGradeInputs.push(riskQuality.companyFinancial.grade)
  const sectionGrade = worstGrade(sectionGradeInputs)
  const { expiringYear, renewalYear } = renewalYears(policy.renewalDate)
  const threeYearRatios = riskQuality.lossRatioHistory.years.map((y) => y.lossRatio) as [number, number, number]

  return (
    <div className="space-y-6">
      {/* Header -- title only, sized/weighted clearly above the section headers below
          (those are text-lg/semibold; this is larger and bolder so it reads as the
          panel-level header, not just another section). The Data Verified/Attention
          pills live here now too, next to the title, rather than down in Identity &
          Context -- they're policy-level status, not specific to that one section.
          The rating explanation sits next to the "Risk Quality" section header
          instead, one level down from the panel title. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Risk Assessment</h1>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${verifiedPillClasses(dnbVerified)}`}>
            {dnbVerified ? 'Data Verified (D&B match found)' : 'Data Not Verified (D&B No Match)'}
          </span>
          <SeverityBadge attention={policy.attention} />
        </div>
      </div>

      {/* Two-column top section: Identity & Context (left) / Renewal Economics (right). */}
      <div className="grid gap-8 border-b border-slate-200 pb-6 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Identity &amp; Context</h2>
          <dl>
            <InfoRow label="Policy Number" value={policy.id} />
            <InfoRow label="VAT Number" value={policy.customerIdentifier} />
            <InfoRow label="Customer Name" value={policy.customerName} />
            <InfoRow label="Broker Name" value={policy.brokerName} />
            <InfoRow label="Current Term End Date" value={formatDate(policy.renewalDate)} />
          </dl>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Renewal Economics</h2>
          <dl>
            <InfoRow
              label="Expiring Premium"
              value={`${formatCurrency(riskQuality.renewalEconomics.expiringPremium, policy.currency)} (${expiringYear})`}
            />
            <InfoRow
              label="Renewal Proposed Premium"
              value={`${formatCurrency(riskQuality.renewalEconomics.renewalPremium, policy.currency)} (${renewalYear})`}
            />
            <InfoRow
              label="% change"
              value={
                <span className={riskQuality.renewalEconomics.movementPercent >= 0 ? 'text-brand' : 'text-slate-600'}>
                  {riskQuality.renewalEconomics.movementPercent >= 0 ? '+' : ''}
                  {riskQuality.renewalEconomics.movementPercent}%
                </span>
              }
            />
          </dl>
          <div className="mt-4">
            <p className="text-sm font-semibold text-slate-900">3 Year Loss Ratio Trend</p>
            <div className="mt-1">
              <Sparkline values={threeYearRatios} />
            </div>
          </div>
        </section>
      </div>

      {/* Risk Quality -- information-only (no recommendation/suggested action here
          anymore; the rating explanation moved up to the header). Data Confidence and
          Operational/Company & Financial grades are derived from real flag data;
          Historical Performance and the figures below are still mocked. Section stays
          boxed (unlike the report-style sections around it) specifically so the
          worst-of-three grade coloring below means something. */}
      <section className={`rounded-lg border p-4 shadow-sm ${riskQualitySectionClasses(sectionGrade)}`}>
        {/* Rating explanation as right-aligned subtext beside this header (demoted a
            level from the panel title, per the same "secondary/dynamic info" logic). */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900">Risk Quality</h2>
          <p className="max-w-md text-right text-sm text-slate-500">{ratingExplanation}</p>
        </div>

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
            scaleInfo="A = no Stage 2 flags fired. B = exactly one flag. C = two or more of D&B Rating Below A, Latest Profit Negative, Assets Moved >25% YoY, or D&B Listed Company."
            grade={riskQuality.companyFinancial?.grade ?? null}
            momentum={riskQuality.companyFinancial?.momentum ?? 'stable'}
            reason={riskQuality.companyFinancial?.reason}
          />
          {/* Renamed from "Historical" -- shares its exact name with the Historical
              Performance section further down (the one with the loss ratio table).
              That's intentional: this is the grade card, that's the section. Its
              sparkline moved up to Renewal Economics, so no `history` prop here. */}
          <GradeCard
            label="Historical Performance"
            scaleInfo="Reflects historical claims performance. A persistent loss-ratio increase raises a Watch flag even before the letter grade changes."
            grade={riskQuality.historical.grade}
            momentum={riskQuality.historical.momentum}
            reason={riskQuality.historical.reason}
            watch={riskQuality.trendWatch}
          />
        </div>

        {/* Flag Reasons, promoted up from below the flag breakdown -- it now
            summarizes what's coming before the detailed Y/N list, not after it. */}
        <div className="mt-6">
          <dt className="text-sm text-slate-500">Flag Reasons</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">{policy.flagReasons || EMPTY_VALUE}</dd>
        </div>
      </section>

      {/* Detailed flag breakdown -- renamed to match the grade dimension names above
          (Operational, Company & Financial). The only place the four attention-only
          signals (Data Incomplete, D&B Predictor Concern, D&B Significant Event, D&B
          Listed Status Unknown) are visible, since those don't get their own Y/N row. */}
      <section className="border-b border-slate-200 pb-6">
        <FlagDetailPanel item={policy} stage1Heading="Operational Review Flags" stage2Heading="Company & Financial Flags" />
      </section>

      {/* Historical Performance (the section) -- the 3-Yr Loss Ratio table is the
          primary content, built straight from lossRatioHistory (same data the
          sparkline above reads, so the two can never contradict each other). Claim
          frequency/tenure aren't covered by the table, so they get their own
          matching bordered block (same border-slate-200/white/rounded-md treatment as
          the table) and sub-header, rather than trailing off underneath as an
          afterthought -- still plain InfoRows inside, just framed to read as a
          parallel block instead of a lesser one. Loss ratio/Claims paid/Cumulative
          premium were dropped entirely since the table now shows those same figures
          (plus two more years) more completely. */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Historical Performance</h2>
        <p className="mb-1 text-sm font-semibold text-slate-900">3-Yr Loss Ratio</p>
        <LossRatioTable history={riskQuality.lossRatioHistory} currency={policy.currency} />
        <p className="mb-1 mt-4 text-sm font-semibold text-slate-900">Policy Metrics</p>
        <dl className="rounded-md border border-slate-200 bg-white p-4">
          <InfoRow label="Claim Frequency" value={`${riskQuality.historicalPerformance.claimFrequency.toFixed(1)}/yr`} />
          <InfoRow label="Tenure" value={`${riskQuality.historicalPerformance.tenureYears} yrs`} />
        </dl>
      </section>
    </div>
  )
}

// The visible 3-Yr Loss Ratio table: Year / Gross Premium Written / Claims Incurred /
// Loss Ratio (highlighted) rows, oldest -> newest year columns plus a 3-Yr Avg column.
// Reads lossRatioHistory directly -- no separate math here, so this can never disagree
// with the Renewal Economics sparkline or the Historical Performance grade card, all
// three of which trace back to the same lib/mockRiskQuality.ts data.
function LossRatioTable({
  history,
  currency,
}: {
  history: ReturnType<typeof getRiskQuality>['lossRatioHistory']
  currency: string | null
}) {
  const { years, avgGrossPremiumWritten, avgClaimsIncurred, threeYearLossRatio } = history

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          <tr className="bg-slate-50">
            <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-500">Year</td>
            {years.map((y) => (
              <td key={y.year} className="whitespace-nowrap px-4 py-2 text-right font-medium text-slate-900">
                {y.year}
              </td>
            ))}
            <td className="whitespace-nowrap px-4 py-2 text-right font-medium text-slate-900">3-Yr Avg</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap px-4 py-2 text-slate-500">Gross Premium Written</td>
            {years.map((y) => (
              <td key={y.year} className="whitespace-nowrap px-4 py-2 text-right text-slate-900">
                {formatCompactCurrency(y.grossPremiumWritten, currency)}
              </td>
            ))}
            <td className="whitespace-nowrap px-4 py-2 text-right text-slate-900">{formatCompactCurrency(avgGrossPremiumWritten, currency)}</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap px-4 py-2 text-slate-500">Claims Incurred</td>
            {years.map((y) => (
              <td key={y.year} className="whitespace-nowrap px-4 py-2 text-right text-slate-900">
                {formatCompactCurrency(y.claimsIncurred, currency)}
              </td>
            ))}
            <td className="whitespace-nowrap px-4 py-2 text-right text-slate-900">{formatCompactCurrency(avgClaimsIncurred, currency)}</td>
          </tr>
          <tr className="bg-slate-100 font-semibold text-slate-900">
            <td className="whitespace-nowrap px-4 py-2">Loss Ratio</td>
            {years.map((y) => (
              <td key={y.year} className="whitespace-nowrap px-4 py-2 text-right">
                {Math.round(y.lossRatio * 100)}%
              </td>
            ))}
            <td className="whitespace-nowrap px-4 py-2 text-right">{Math.round(threeYearLossRatio * 100)}%</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
