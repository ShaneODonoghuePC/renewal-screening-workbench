'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { STATUS_TRANSITIONS } from '@/lib/statusWorkflow'
import { formatCurrency, EMPTY_VALUE } from '@/lib/format'
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

type StatusState = { policyId: string; status: string; assignedUserId: string | null }
type Comment = { id: string; policyId: string; userId: string; text: string; createdAt: string }
type ActivityEntry = { id: string; policyId: string; eventType: string; userId: string | null; detail: string | null; createdAt: string }
type Identity = { id: string; name: string; country: string }

// One-click shortcuts for the most common transitions; the dropdown below covers
// everything else (Closed, and the initial New -> In Review step).
const QUICK_TRANSITIONS: Array<{ target: string; label: string }> = [
  { target: 'Renewed', label: 'Renew' },
  { target: 'Not Renewed', label: 'Not Renew' },
  { target: 'Escalated', label: 'Escalate' },
]

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
  const quickTransitions = statusState
    ? QUICK_TRANSITIONS.filter((qt) => (STATUS_TRANSITIONS[statusState.status] ?? []).includes(qt.target))
    : []

  if (error) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">{error}</div>
  }

  if (!policy || !statusState) {
    return <div className="p-6 text-sm text-slate-500">{loading ? 'Loading…' : 'No data.'}</div>
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{policy.id}</h1>
        <p className="mt-1 text-sm text-slate-600">{policy.customerName}</p>
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

      {/* Underwriter Workspace */}
      <section className="rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Underwriter Workspace</h2>

        <div className="flex flex-wrap items-end gap-6">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Status
            <select
              value={statusState.status}
              onChange={(event) => changeStatus(event.target.value)}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          {quickTransitions.length > 0 && (
            <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Quick actions
              <div className="flex gap-2">
                {quickTransitions.map((qt) => (
                  <button
                    key={qt.target}
                    type="button"
                    onClick={() => changeStatus(qt.target)}
                    disabled={saving}
                    className="rounded-lg bg-[#122933] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1c3a49] disabled:opacity-60"
                  >
                    {qt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Assigned to
            <select
              value={statusState.assignedUserId ?? ''}
              onChange={(event) => changeAssignment(event.target.value || null)}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
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
              className="self-end rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
            >
              Assign to me
            </button>
          )}
        </div>

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
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
              <button
                type="button"
                onClick={submitComment}
                disabled={saving || !commentDraft.trim()}
                className="self-start rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
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
