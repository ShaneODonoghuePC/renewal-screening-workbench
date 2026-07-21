'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { STATUS_TRANSITIONS } from '@/lib/statusWorkflow'
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

type StatusState = { policyId: string; status: string; assignedUserId: string | null }
type Comment = { id: string; policyId: string; userId: string; text: string; createdAt: string }
type ActivityEntry = { id: string; policyId: string; eventType: string; userId: string | null; detail: string | null; createdAt: string }
type Identity = { id: string; name: string; country: string }

// Display label for the primary CTA button, keyed by the status it targets — distinct
// from the underlying status value, which stays "Not Renewed" everywhere else (Status
// dropdown, Team View filters, History, activity log).
const ACTION_LABELS: Record<string, string> = {
  Renewed: 'Renew',
  'Not Renewed': 'Decline',
  Escalated: 'Escalate',
}

// Terminal decisions an override reason can apply to — progressing New -> In Review is
// a neutral workflow step, not a judgement call, so it never requires justification.
const TERMINAL_DECISIONS = ['Renewed', 'Not Renewed', 'Escalated']

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
function ragCardClasses(grade: Grade) {
  if (grade === 'C') return 'border-red-200 bg-red-50 text-red-700'
  if (grade === 'B') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-green-200 bg-green-50 text-green-700'
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
    <div className="rounded-xl border border-slate-200 bg-white p-4">
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
      <div className="mt-2 flex items-center gap-3">
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
        {history && <Sparkline values={history} />}
      </div>
      {reason && <p className="mt-2 text-xs text-slate-500">{reason}</p>}
      {!grade && <p className="mt-2 text-xs text-slate-500">Not yet graded — Unverified.</p>}
      {watch && (
        <span className="mt-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          Watch — worsening trend
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

function formatTimestamp(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function activityDescription(entry: ActivityEntry, userNameById: Map<string, string>) {
  const actor = entry.userId ? userNameById.get(entry.userId) ?? entry.userId : 'Unknown'
  let detail: Record<string, unknown> = {}
  try {
    detail = entry.detail ? JSON.parse(entry.detail) : {}
  } catch {
    detail = {}
  }

  if (entry.eventType === 'status_change') {
    return `${actor} changed status from ${detail.from ?? EMPTY_VALUE} to ${detail.to ?? EMPTY_VALUE}`
  }
  if (entry.eventType === 'assignment_change') {
    const from = detail.from ? userNameById.get(String(detail.from)) ?? detail.from : 'Unassigned'
    const to = detail.to ? userNameById.get(String(detail.to)) ?? detail.to : 'Unassigned'
    return `${actor} reassigned from ${from} to ${to}`
  }
  if (entry.eventType === 'comment_added') {
    return `${actor} added a comment`
  }
  return `${actor}: ${entry.eventType}`
}

// Full Underwriter Workspace for a Manual Review policy: identity/context, Stage 1/2
// flags, derived fields, status + assignment controls, comments, activity log. Shared
// by the standalone /review/manual/[id] page and Team View's slide-out review panel —
// same data, same actions, just different surrounding chrome.
export default function ManualReviewWorkspace({
  policyId,
  onUpdate,
}: {
  policyId: string
  onUpdate?: () => void
}) {
  const [policy, setPolicy] = useState<PolicyDetail | null>(null)
  const [statusState, setStatusState] = useState<StatusState | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [users, setUsers] = useState<Identity[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingOverride, setPendingOverride] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const encodedId = encodeURIComponent(policyId)
      const [policyRes, statusRes, commentsRes, activityRes, usersRes, sessionRes] = await Promise.all([
        fetch(`/api/policies/${encodedId}`, { credentials: 'include' }),
        fetch(`/api/policies/${encodedId}/status`, { credentials: 'include' }),
        fetch(`/api/policies/${encodedId}/comments`, { credentials: 'include' }),
        fetch(`/api/policies/${encodedId}/activity`, { credentials: 'include' }),
        fetch('/api/users', { credentials: 'include' }),
        fetch('/api/session', { credentials: 'include' }),
      ])

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
      if (statusRes.ok) setStatusState(await statusRes.json())
      if (commentsRes.ok) setComments(await commentsRes.json())
      if (activityRes.ok) setActivity(await activityRes.json())
      if (usersRes.ok) setUsers(await usersRes.json())
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json()
        setCurrentUserId(sessionData.userId)
      }
    } catch {
      setError('Unable to load this policy. Check your connection.')
    } finally {
      setLoading(false)
    }
  }, [policyId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const refreshWorkspace = useCallback(async () => {
    const encodedId = encodeURIComponent(policyId)
    const [statusRes, commentsRes, activityRes] = await Promise.all([
      fetch(`/api/policies/${encodedId}/status`, { credentials: 'include' }),
      fetch(`/api/policies/${encodedId}/comments`, { credentials: 'include' }),
      fetch(`/api/policies/${encodedId}/activity`, { credentials: 'include' }),
    ])
    if (statusRes.ok) setStatusState(await statusRes.json())
    if (commentsRes.ok) setComments(await commentsRes.json())
    if (activityRes.ok) setActivity(await activityRes.json())
    onUpdate?.()
  }, [policyId, onUpdate])

  const changeStatus = async (newStatus: string) => {
    if (!statusState) return
    setSaving(true)
    try {
      await fetch(`/api/policies/${encodeURIComponent(policyId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus, assignedUserId: statusState.assignedUserId }),
      })
      await refreshWorkspace()
    } finally {
      setSaving(false)
    }
  }

  // Any terminal decision that disagrees with the computed recommendation requires a
  // reason before it saves — reuses the existing status dropdown/quick actions and the
  // existing comment field, no new statuses introduced.
  const requestStatusChange = (newStatus: string, suggestedStatus: string) => {
    if (!statusState || newStatus === statusState.status) return
    if (TERMINAL_DECISIONS.includes(newStatus) && newStatus !== suggestedStatus) {
      setPendingOverride(newStatus)
      return
    }
    setPendingOverride(null)
    changeStatus(newStatus)
  }

  const confirmOverride = async () => {
    if (!pendingOverride || !commentDraft.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/policies/${encodeURIComponent(policyId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: commentDraft.trim() }),
      })
      setCommentDraft('')
      if (statusState) {
        await fetch(`/api/policies/${encodeURIComponent(policyId)}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: pendingOverride, assignedUserId: statusState.assignedUserId }),
        })
      }
      setPendingOverride(null)
      await refreshWorkspace()
    } finally {
      setSaving(false)
    }
  }

  const cancelOverride = () => setPendingOverride(null)

  const changeAssignment = async (newUserId: string | null) => {
    if (!statusState) return
    setSaving(true)
    try {
      await fetch(`/api/policies/${encodeURIComponent(policyId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: statusState.status, assignedUserId: newUserId }),
      })
      await refreshWorkspace()
    } finally {
      setSaving(false)
    }
  }

  const submitComment = async () => {
    if (!commentDraft.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/policies/${encodeURIComponent(policyId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: commentDraft.trim() }),
      })
      setCommentDraft('')
      await refreshWorkspace()
    } finally {
      setSaving(false)
    }
  }

  const userNameById = useMemo(() => {
    const map = new Map<string, string>()
    users.forEach((user) => map.set(user.id, user.name))
    return map
  }, [users])

  const statusOptions = statusState
    ? [statusState.status, ...(STATUS_TRANSITIONS[statusState.status] ?? [])]
    : []

  if (error) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">{error}</div>
  }

  if (!policy || !statusState) {
    return <div className="p-6 text-sm text-slate-500">{loading ? 'Loading…' : 'No data.'}</div>
  }

  // Data Confidence and the Operational / Company & Financial grades are derived from
  // policy's real flag data; Historical and the figures below stay mocked (see
  // lib/mockRiskQuality.ts for exactly which parts are real vs. still simulated).
  const riskQuality = getRiskQuality(policy)
  const recommendation = computeRecommendation(riskQuality)

  // Single primary CTA matching the computed recommendation — replaces the old
  // three-equal-buttons row, which duplicated both the Status dropdown and the
  // recommendation text above. Anything else the underwriter wants is one dropdown away.
  const primaryActionAvailable = (STATUS_TRANSITIONS[statusState.status] ?? []).includes(recommendation.suggestedStatus)

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{policy.id}</h1>
            <p className="mt-1 text-sm text-slate-600">{policy.customerName}</p>
          </div>
          <div className="flex items-center gap-2">
            <SeverityBadge attention={policy.attention} />
          </div>
        </div>
      </section>

      {/* Risk Quality — Data Confidence and Operational/Company & Financial grades are
          derived from real flag data; Historical and the figures below are still mocked. */}
      <section className="rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Risk Quality</h2>

        {!riskQuality.verified && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Data confidence is Unverified (D&amp;B No Match or D&amp;B Status Inactive) — Company &amp; Financial
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
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Renewal economics</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {formatCurrency(riskQuality.renewalEconomics.expiringPremium, policy.currency)}
              {' → '}
              {formatCurrency(riskQuality.renewalEconomics.renewalPremium, policy.currency)}{' '}
              <span className={riskQuality.renewalEconomics.movementPercent >= 0 ? 'text-brand' : 'text-slate-600'}>
                ({riskQuality.renewalEconomics.movementPercent >= 0 ? '+' : ''}
                {riskQuality.renewalEconomics.movementPercent}%)
              </span>
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Computed recommendation</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{recommendation.text}</p>
          </div>
        </div>
      </section>

      {/* Identity & Context */}
      <section className="rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Identity &amp; Context</h2>
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

      <section className="rounded-2xl border border-slate-200 p-6 shadow-sm">
        <FlagDetailPanel item={policy} />
      </section>

      {/* Derived */}
      <section className="rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Derived</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Stage 1 Flags</dt><dd className="font-medium text-slate-900">{policy.stage1FlagCount}</dd></div>
          <div><dt className="text-slate-500">Stage 2 Flags</dt><dd className="font-medium text-slate-900">{policy.stage2FlagCount}</dd></div>
          <div><dt className="text-slate-500">Routing</dt><dd className="font-medium text-slate-900">{policy.routing || EMPTY_VALUE}</dd></div>
          <div><dt className="text-slate-500">Attention</dt><dd className="font-medium text-slate-900">{policy.attention || EMPTY_VALUE}</dd></div>
        </dl>
        <div className="mt-4">
          <dt className="text-sm text-slate-500">Flag Reasons</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">{policy.flagReasons || EMPTY_VALUE}</dd>
        </div>
      </section>

      {/* Historical Performance — mocked, does not affect grade */}
      <section className="rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Historical Performance</h2>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div
            className={`flex h-full min-w-0 flex-col justify-between rounded-xl border p-4 ${ragCardClasses(
              computeHistoricalGrade(riskQuality.historicalPerformance.lossRatio)
            )}`}
          >
            <p className="text-xs font-medium opacity-75">Loss ratio</p>
            <p className="whitespace-nowrap text-xl font-semibold">{Math.round(riskQuality.historicalPerformance.lossRatio * 100)}%</p>
          </div>
          <div className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Claims paid</p>
            <p className="whitespace-nowrap text-lg font-semibold text-slate-900" title={formatCurrency(riskQuality.historicalPerformance.claimsPaid, policy.currency)}>
              {formatCompactCurrency(riskQuality.historicalPerformance.claimsPaid, policy.currency)}
            </p>
          </div>
          <div className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Cumulative premium</p>
            <p className="whitespace-nowrap text-lg font-semibold text-slate-900" title={formatCurrency(riskQuality.historicalPerformance.cumulativePremium, policy.currency)}>
              {formatCompactCurrency(riskQuality.historicalPerformance.cumulativePremium, policy.currency)}
            </p>
          </div>
          <div className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Claim frequency</p>
            <p className="whitespace-nowrap text-xl font-semibold text-slate-900">
              {riskQuality.historicalPerformance.claimFrequency.toFixed(1)}/yr
            </p>
          </div>
          <div className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Tenure</p>
            <p className="whitespace-nowrap text-xl font-semibold text-slate-900">{riskQuality.historicalPerformance.tenureYears} yrs</p>
          </div>
        </div>
      </section>

      {/* Underwriter Workspace */}
      <section className="rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Underwriter Workspace</h2>

        <div className="flex flex-wrap items-end gap-6">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Status
            <select
              value={statusState.status}
              onChange={(event) => requestStatusChange(event.target.value, recommendation.suggestedStatus)}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-60"
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          {primaryActionAvailable && (
            <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Recommended action
              <button
                type="button"
                onClick={() => requestStatusChange(recommendation.suggestedStatus, recommendation.suggestedStatus)}
                disabled={saving}
                className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark active:bg-brand-dark disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                {ACTION_LABELS[recommendation.suggestedStatus] ?? recommendation.suggestedStatus}
              </button>
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Assigned to
            <select
              value={statusState.assignedUserId ?? ''}
              onChange={(event) => changeAssignment(event.target.value || null)}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-60"
            >
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
          </label>

          {!statusState.assignedUserId && currentUserId && (
            <button
              type="button"
              onClick={() => changeAssignment(currentUserId)}
              disabled={saving}
              className="self-end rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark active:bg-brand-dark disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              Assign to me
            </button>
          )}
        </div>

        {pendingOverride && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p>
              Changing status to <strong>{pendingOverride}</strong> differs from the computed recommendation
              ("{recommendation.text}"). Add a reason in the comment box below, then confirm.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={confirmOverride}
                disabled={saving || !commentDraft.trim()}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark active:bg-brand-dark disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                Confirm change with reason
              </button>
              <button
                type="button"
                onClick={cancelOverride}
                disabled={saving}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Comments</h3>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              {comments.length === 0 && <p className="text-sm text-slate-500">No comments yet.</p>}
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-lg bg-white p-3 text-sm shadow-sm">
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{userNameById.get(comment.userId) ?? comment.userId}</span>
                    <span>{formatTimestamp(comment.createdAt)}</span>
                  </div>
                  <p className="text-slate-800">{comment.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Add a comment…"
                rows={2}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
              <button
                type="button"
                onClick={submitComment}
                disabled={saving || !commentDraft.trim()}
                className="self-start rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark active:bg-brand-dark disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                Add comment
              </button>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Activity log</h3>
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              {activity.length === 0 && <p className="text-sm text-slate-500">No activity yet.</p>}
              {activity.map((entry) => (
                <div key={entry.id} className="rounded-lg bg-white p-3 text-sm shadow-sm">
                  <div className="mb-1 text-xs text-slate-500">{formatTimestamp(entry.createdAt)}</div>
                  <p className="text-slate-800">{activityDescription(entry, userNameById)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
