'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatCurrency, formatCompactCurrency, EMPTY_VALUE } from '@/lib/format'
import { getRiskQuality, unverifiedCompanyFinancialDetails, historicalGradeScaleInfo, type Grade } from '@/lib/mockRiskQuality'
import { attentionOnlyFlags, scoringFlags } from '@/lib/flags'
import FlagDetailPanel, { type FlagEvidence } from '@/components/FlagDetailPanel'

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

// Worst-of-three across the graded dimensions (Company & Financial excluded from the
// array entirely while Unverified) -- this is what colors the whole three-card block,
// so one B among otherwise-A grades still reads as amber at a glance, not just on that
// one card.
function worstGrade(grades: Grade[]): Grade {
  if (grades.includes('C')) return 'C'
  if (grades.includes('B')) return 'B'
  return 'A'
}

// Border/bg only (no text color) so this can wrap the whole block without overriding
// the slate text colors already set on its children. Grade A -- the best-grade case --
// gets the sage accent tint per the brand's small-footprint-accent rule; the grade
// badges inside stay green-600 regardless, so they read clearly against the sage bg.
function riskQualitySectionClasses(grade: Grade) {
  if (grade === 'C') return 'border-red-300 bg-red-50'
  if (grade === 'B') return 'border-amber-300 bg-amber-50'
  return 'border-sage-300 bg-sage-50'
}

// Grade card, 2026-09-09 redesign: no momentum arrow (removed entirely, see
// lib/mockRiskQuality.ts -- nothing else consumed it), content centered, and the info
// affordance moved to a top-right corner button with an actual hover/focus popover
// (a <ul>, not a native `title` tooltip -- a native tooltip can't render a list at
// all) styled to read as obviously interactive, which the old plain-circle-with-title
// treatment didn't. The one place still explaining "why this grade" is this popover;
// there's no separate reason line under the circle any more.
//
// 2026-09-10: popover shrunk ~25% (w-64 p-3 -> w-48 p-2). `scaleInfo` is a string[] now
// (one line per band, plain stacked lines, not bulleted -- the A/B/C prefix on each
// line already does what a bullet would) instead of a single sentence, same reasoning
// as `details` already being a list.
//
// Trigger circle shrunk a further 25% the same day (h-6 w-6 / 24px -> visible circle
// h-[18px] w-[18px]) -- an arbitrary value, not h-5, so it's actually 18px and not a
// rounded-to-the-nearest-step approximation. The <button> itself STAYS 24px (h-6 w-6)
// as the real hit/focus target; the smaller visible circle is an inner <span>, inset by
// the button's own p-[3px] padding ((24-18)/2 = 3 each side) -- "padding on the
// wrapper," per the brief, rather than shrinking the interactive element itself, so the
// hover/click area and the keyboard focus ring stay comfortable even though the circle
// reads smaller. Glyph dropped to text-[10px] (from text-xs/12px) since 12px looked
// cramped in an 18px circle; 18px is the floor for the circle itself, not the glyph.
function GradeCard({
  label,
  scaleInfo,
  grade,
  unverifiedReason,
}: {
  label: string
  scaleInfo: string[]
  grade: Grade | null
  // Only ever passed (and only ever rendered) when grade is null -- the Company &
  // Financial N/A explanation (2026-09-11: the fired-flag detail list every card used to
  // carry here is gone; "Flags Raised," moved into this same three-card section below,
  // is where fired flags live now). Operational and Historical never pass this, since
  // their grade is never null.
  unverifiedReason?: string[]
}) {
  return (
    <div className="relative rounded-md border border-slate-200 bg-white p-3 text-center">
      <div className="group absolute right-2 top-2">
        <button
          type="button"
          className="group/btn flex h-6 w-6 items-center justify-center rounded-full p-[3px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          aria-label={`What ${label} grades mean, and why this one`}
        >
          <span className="flex h-full w-full items-center justify-center rounded-full bg-slate-700 text-[10px] font-bold leading-none text-white shadow-sm transition group-hover/btn:bg-brand">
            ?
          </span>
        </button>
        <div
          role="tooltip"
          className="invisible absolute right-0 top-full z-30 mt-2 w-48 -translate-y-1 rounded-lg border border-slate-200 bg-white p-2 text-left text-xs text-slate-700 opacity-0 shadow-lg transition duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100"
        >
          <div className={`space-y-0.5 font-semibold text-slate-900 ${unverifiedReason?.length ? 'mb-1.5' : ''}`}>
            {scaleInfo.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          {unverifiedReason && unverifiedReason.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4">
              {unverifiedReason.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 2026-09-10: matched to FlagDetailPanel's section headings (text-sm
          font-semibold text-slate-900, components/FlagDetailPanel.tsx) so these read
          as peers of "Operational Review Flags"/"Company & Financial Flags" rather
          than small grey captions. Left as a <p>, not promoted to a heading element --
          the three-card block deliberately has no section header/headline above it
          (2026-09-09), so there's no h2 for an h3 here to nest under without reading
          oddly against the real section h2s elsewhere on the panel (Loss Ratio,
          Identity & Context). */}
      <p className="text-sm font-semibold text-slate-900">{label}</p>
      <div className="mt-2 flex justify-center">
        {grade ? (
          <span
            className={`inline-flex h-[45px] w-[45px] items-center justify-center rounded-full text-xl font-bold ${gradeBadgeClasses(grade)}`}
          >
            {grade}
          </span>
        ) : (
          <span className="inline-flex h-[45px] w-[45px] items-center justify-center rounded-full border border-dashed border-slate-300 text-xs font-medium text-slate-400">
            N/A
          </span>
        )}
      </div>
      {!grade && <p className="mt-2 text-xs text-slate-500">Not yet graded: Unverified.</p>}
    </div>
  )
}

// Single label-left/value-right row, used throughout Identity & Context and Renewal
// Financials -- tight py-1 spacing (vs. the old 2-col grid's gap-4) per the new layout.
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
      {/* text-slate-700, matching FlagRow's label colour exactly (2026-09-12, was
          text-slate-500 -- noticeably lighter than the flag containers' own row
          labels, an inconsistency this pass corrects). */}
      <span className="text-slate-700">{label}</span>
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

// Expiring/renewal years for the Renewal Financials line -- there's no separate stored
// "expiring premium year," so it's derived as the year before the renewal date's year,
// same cycle-to-cycle relationship the expiring vs. renewal premium figures represent.
function renewalYears(renewalDate: string | null): { expiringYear: string; renewalYear: string } {
  if (!renewalDate) return { expiringYear: EMPTY_VALUE, renewalYear: EMPTY_VALUE }
  const date = new Date(`${renewalDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return { expiringYear: EMPTY_VALUE, renewalYear: EMPTY_VALUE }
  const renewalYear = date.getUTCFullYear()
  return { expiringYear: String(renewalYear - 1), renewalYear: String(renewalYear) }
}

function pct(ratio: number) {
  return `${Math.round(ratio * 100)}%`
}

// Risk Evaluation panel (display name; the component/type identifiers this file and
// lib/mockRiskQuality.ts use -- RiskQualityPanel, renewalEconomics -- are deliberately
// left as they are, 2026-09-09: renaming them would touch the shape the panel
// consumes, out of scope for a display-only rename. See SPEC.md S5.4 for this same
// divergence noted the way renewalEconomics/Renewal Financials already was.
//
// Section order, top to bottom (2026-09-10, supersedes the previous order): title
// only (no pills) -> the three graded dimension cards (no header/headline) ->
// Identity & Context / Renewal Financials (two columns) -> Loss Ratio -> Flags Raised
// -- now the shared section header for the rest of the panel (2026-09-10, was its own
// standalone "Flags Raised: <flagReasons>" summary line below the tables), containing,
// in order: the "Attention Flags" sub-header + inline list (only when at least one
// attention-only flag is present, SPEC.md S3.2 -- these never get a Y/N row below),
// then Operational Review Flags / Company & Financial Flags. Historical Performance
// (the old section, and its Policy Metrics block) is gone entirely -- Policy Tenure,
// the one thing in it that wasn't superseded by the Loss Ratio section, moved into
// Identity & Context.
//
// Read-only -- status/assignment/comments/activity live in the separate Underwriter
// Workspace (components/UnderwriterWorkspace.tsx), reached via the table's expand row.
// Shared by the standalone /review/manual/[id] page and Renewal Management's
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
  // policy's real flag data; Historical and the loss-ratio figures below stay mocked
  // (see lib/mockRiskQuality.ts for exactly which parts are real vs. still simulated).
  const riskQuality = getRiskQuality(policy)
  const sectionGradeInputs: Grade[] = [riskQuality.operational.grade, riskQuality.historical.grade]
  if (riskQuality.companyFinancial) sectionGradeInputs.push(riskQuality.companyFinancial.grade)
  const sectionGrade = worstGrade(sectionGradeInputs)
  const { expiringYear, renewalYear } = renewalYears(policy.renewalDate)
  const { oneYear, twoYear, threeYear, allYears } = riskQuality.lossRatioHistory
  // The four attention-only signals (Data Incomplete, D&B Predictor Concern, D&B
  // Significant Event, D&B Listed Status Unknown, SPEC.md S3.2) never get a Y/N row in
  // FlagDetailPanel below -- this is the only place they're still visible on this
  // panel, via lib/flags.ts's shared parser (2026-09-10; previously only app/page.tsx
  // parsed flagReasons, and this panel had no equivalent -- see the standalone
  // "Flags Raised: <flagReasons>" line this replaces, below).
  const attentionFlags = attentionOnlyFlags(policy.flagReasons)
  const firedFlags = scoringFlags(policy.flagReasons)

  return (
    <div className="rounded-lg bg-slate-50 p-4 md:p-6">
      <div className="space-y-6">
      {/* Header -- title only. The Data Verified/Attention pills that used to live
          here were removed 2026-09-09; the D&B-no-match explanation that was the
          pill's only real purpose now lives in the Company & Financial card's own
          tooltip (see GradeCard/unverifiedCompanyFinancialDetails), where it belongs
          next to the grade it actually affects. */}
      <div className="border-b border-slate-200 pb-4">
        {/* pr-28 (2026-09-13): clearance for the slide-out's floating Close button
            (SlideOutPanel.tsx), which sits at right-4 and is ~80px wide -- applied
            unconditionally, on the title itself rather than a wrapper (so nothing
            below it is indented), since right padding on a left-aligned heading is
            invisible in the standalone /review/manual/[id] page, which doesn't use
            SlideOutPanel at all. No prop for this -- the component stays host-agnostic
            rather than one host reaching in to configure it. */}
        <h1 className="pr-28 text-2xl font-bold text-slate-900">Risk Evaluation</h1>
      </div>

      {/* The three graded dimension cards -- no section header, no headline, promoted
          to the very top of the panel body (2026-09-09). Still wrapped in the
          worst-of-three colored box (unchanged since 2026-07-22): one C anywhere
          turns the whole box red even if the other two are A. "Flags Raised" (2026-09-11,
          moved back into this section from its own standalone section below -- see the
          block after the card grid) sits at the bottom of the same box, left-aligned,
          in the "header: list" inline style the very first version of this summary
          used, rather than as itemized Y/N rows -- those still live in FlagDetailPanel,
          reached via the Underwriter Workspace/table expand-row, not duplicated here. */}
      <section className={`rounded-lg border p-4 shadow-sm ${riskQualitySectionClasses(sectionGrade)}`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <GradeCard
            label="Operational"
            scaleInfo={[
              'A = no Operational Review Flags fired.',
              'B = exactly one non-critical flag.',
              'C = Open Claim, Premium Unpaid, or 2+ flags fired.',
            ]}
            grade={riskQuality.operational.grade}
          />
          <GradeCard
            label="Company & Financial"
            // Simplified 2026-09-12 -- no longer enumerates all seven scoring flags on
            // the C line (the reason this tooltip used to be the longest of the three).
            // The Company & Financial Flags table below already lists every flag, and
            // "Flags Raised" lists the ones that actually fired, so nothing is lost by
            // dropping the enumeration here. See SPEC.md S5.4 for why the three grade
            // cards' tooltips are now genuinely different shapes -- Operational's C
            // line still has to name Open Claim/Premium Unpaid (each forces a C alone),
            // and Historical's still carries the HISTORICAL_GRADE_BANDS percentages --
            // and why that's correct rather than an inconsistency to "fix" later.
            scaleInfo={[
              'A = no Company & Financial Flags fired.',
              'B = exactly one flag.',
              'C = two or more flags.',
            ]}
            grade={riskQuality.companyFinancial?.grade ?? null}
            unverifiedReason={riskQuality.companyFinancial ? undefined : unverifiedCompanyFinancialDetails(policy)}
          />
          <GradeCard
            label="Historical Performance"
            scaleInfo={historicalGradeScaleInfo()}
            grade={riskQuality.historical.grade}
          />
        </div>

        <div className="mt-4 border-t border-slate-200/70 pt-4 text-left">
          {attentionFlags.length > 0 && (
            <p className="mb-1 text-sm">
              <span className="font-semibold text-slate-900">Attention Flags: </span>
              <span className="text-slate-700">{attentionFlags.join(', ')}</span>
            </p>
          )}
          <p className="text-sm">
            <span className="font-semibold text-slate-900">Flags Raised: </span>
            <span className="text-slate-700">{firedFlags.length > 0 ? firedFlags.join(', ') : 'None'}</span>
          </p>
        </div>
      </section>

      {/* Two-column section: Identity & Context (left) / Renewal Financials (right).
          Each column boxed to match FlagDetailPanel's own flex flex-col + flex-1 box
          treatment (2026-09-11, components/FlagDetailPanel.tsx) -- flex-1 on the inner
          box is what makes the shorter column (Renewal Financials, 3 rows) stretch to
          match the taller one (Identity & Context, 6 rows) rather than trailing off
          with blank space beside it. The h2 headings stay above the boxes, unchanged
          size (text-lg) -- FlagDetailPanel's own headings are h3/text-sm, a genuine
          size difference between the two box styles left as-is pending a call from
          Shane on whether it should be reconciled. */}
      <div className="grid gap-8 border-b border-slate-200 pb-6 md:grid-cols-2">
        <section className="flex flex-col">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Identity &amp; Context</h2>
          <div className="flex-1 rounded-md border border-slate-200 bg-white p-4">
            <dl>
              <InfoRow label="Policy Number" value={policy.id} />
              <InfoRow label="VAT Number" value={policy.customerIdentifier} />
              <InfoRow label="Customer Name" value={policy.customerName} />
              <InfoRow label="Broker Name" value={policy.brokerName} />
              <InfoRow label="Current Term End Date" value={formatDate(policy.renewalDate)} />
              <InfoRow label="Policy Tenure" value={`${riskQuality.policyTenureYears} year${riskQuality.policyTenureYears === 1 ? '' : 's'}`} />
            </dl>
          </div>
        </section>

        <section className="flex flex-col">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Renewal Financials</h2>
          <div className="flex-1 rounded-md border border-slate-200 bg-white p-4">
            <dl>
              <InfoRow
                label="Expiring Premium"
                value={`${formatCurrency(riskQuality.renewalEconomics.expiringPremium, policy.currency)} (${expiringYear})`}
              />
              <InfoRow
                label="Proposed Premium"
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
          </div>
        </section>
      </div>

      {/* Loss Ratio -- promoted to its own standalone section (2026-09-09), directly
          below Identity & Context / Renewal Financials. Cumulative nested windows
          (1/2/3/All Years), not oldest->newest single years -- see LossRatioTable. */}
      <section className="border-b border-slate-200 pb-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Loss Ratio</h2>
        <LossRatioTable oneYear={oneYear} twoYear={twoYear} threeYear={threeYear} allYears={allYears} currency={policy.currency} />
      </section>

      {/* The itemized Y/N flag breakdown -- no "Flags Raised" header above it any more
          (2026-09-11: that name now lives exactly once, in the three-card section
          above). The two tables keep their own h3 headings (Operational Review Flags /
          Company & Financial Flags), which is label enough on its own. */}
      <section>
        <FlagDetailPanel item={policy} stage1Heading="Operational Review Flags" stage2Heading="Company & Financial Flags" />
      </section>
      </div>
    </div>
  )
}

// The Loss Ratio table: four cumulative windows (1 Year / 2 Years / 3 Years / All
// Years, all "(Earned)"), narrowest to widest, left to right. Rows: Loss Ratio /
// Claims Incurred / Claims Frequency / Premium Earned / Premium Written. Loss Ratio is
// always claimsIncurred/premiumEarned for that column's own cumulative figures (see
// lib/mockRiskQuality.ts's buildWindow) -- never computed independently here.
function LossRatioTable({
  oneYear,
  twoYear,
  threeYear,
  allYears,
  currency,
}: {
  oneYear: ReturnType<typeof getRiskQuality>['lossRatioHistory']['oneYear']
  twoYear: ReturnType<typeof getRiskQuality>['lossRatioHistory']['twoYear']
  threeYear: ReturnType<typeof getRiskQuality>['lossRatioHistory']['threeYear']
  allYears: ReturnType<typeof getRiskQuality>['lossRatioHistory']['allYears']
  currency: string | null
}) {
  const windows = [oneYear, twoYear, threeYear, allYears]

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {/* Fills changed to a warm neutral 2026-09-12 -- the 2026-09-11 slate swap
              (header bg-slate-100, Loss Ratio bg-slate-50) left the Loss Ratio row
              exactly matching the panel's own bg-slate-50 root fill (RiskQualityPanel's
              return statement above), so the table read as barely separated from the
              page behind it. stone (warm) reads as a deliberate complementary choice
              against the panel's cool slate-50 and harmonises with the app's putty page
              background, and carries none of the sage (best-grade tint) or amber/red
              (flag-severity) meanings already claimed elsewhere in this app. Header
              bg-stone-200, Loss Ratio row bg-stone-100 -- a genuine two-step jump
              (50 and 200 read too close to each other at this size; 100 keeps a real
              visible gap from 200 while landing clearly warmer/darker than the panel's
              slate-50 too, verified via computed background-color, not eyeballed).
              Both against the explicit bg-white on this wrapper above (2026-09-11) so
              this table stays white now that the panel around it has its own subtle
              fill -- without it, the unstyled rows below (Claims Incurred etc.) would
              show the panel's tint through the table's own transparent background. */}
          <tr className="bg-stone-200">
            <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-500"></td>
            {windows.map((w) => (
              <td key={w.label} className="whitespace-nowrap px-4 py-2 text-right font-medium text-slate-900">
                {w.label}
              </td>
            ))}
          </tr>
          <tr className="bg-stone-100 font-semibold text-slate-900">
            <td className="whitespace-nowrap px-4 py-2">Loss Ratio</td>
            {windows.map((w) => (
              <td key={w.label} className="whitespace-nowrap px-4 py-2 text-right">
                {pct(w.lossRatio)}
              </td>
            ))}
          </tr>
          {/* Row-label cells below: text-slate-700 (2026-09-12, was text-slate-500),
              matching FlagRow's label colour exactly -- same fix as InfoRow above. */}
          <tr>
            <td className="whitespace-nowrap px-4 py-2 text-slate-700">Claims Incurred</td>
            {windows.map((w) => (
              <td key={w.label} className="whitespace-nowrap px-4 py-2 text-right text-slate-900">
                {formatCompactCurrency(w.claimsIncurred, currency)}
              </td>
            ))}
          </tr>
          <tr>
            <td className="whitespace-nowrap px-4 py-2 text-slate-700">Claims Frequency</td>
            {windows.map((w) => (
              <td key={w.label} className="whitespace-nowrap px-4 py-2 text-right text-slate-900">
                {w.claimsCount}
              </td>
            ))}
          </tr>
          <tr>
            <td className="whitespace-nowrap px-4 py-2 text-slate-700">Premium Earned</td>
            {windows.map((w) => (
              <td key={w.label} className="whitespace-nowrap px-4 py-2 text-right text-slate-900">
                {formatCompactCurrency(w.premiumEarned, currency)}
              </td>
            ))}
          </tr>
          <tr>
            <td className="whitespace-nowrap px-4 py-2 text-slate-700">Premium Written</td>
            {windows.map((w) => (
              <td key={w.label} className="whitespace-nowrap px-4 py-2 text-right text-slate-900">
                {formatCompactCurrency(w.premiumWritten, currency)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
