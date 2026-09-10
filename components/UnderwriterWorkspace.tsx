'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MANUAL_REVIEW_TRANSITIONS, NAVINS_RENEW_TRANSITIONS } from '@/lib/statusWorkflow'
import { EMPTY_VALUE } from '@/lib/format'
import { FILTER_WIDTH } from '@/lib/ui'

type StatusState = { policyId: string; status: string; assignedUserId: string | null }
type Comment = { id: string; policyId: string; userId: string; text: string; createdAt: string }
type ActivityEntry = { id: string; policyId: string; eventType: string; userId: string | null; detail: string | null; createdAt: string }
type Identity = { id: string; name: string; country: string }

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
  if (entry.eventType === 'status_migration') {
    return `System: status migrated from ${detail.from ?? EMPTY_VALUE} to ${detail.to ?? EMPTY_VALUE} (${detail.reason ?? 'workflow migration'})`
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

// Status control, assigned-to, comment thread, and activity log for a single policy --
// used inline in Renewal Management's row-expansion, for Manual Review and Navins
// Renew rows (routing picks which status-transition graph applies), plus Closed rows
// of either routing in read-only mode. Split out from
// the Risk Quality Panel (Phase 2A): that one stays reachable the same way it always
// was (Review button slide-out / standalone page); this one is new UI, wired to the
// same existing comments/activity_log tables, which were already generic per policy.
export default function UnderwriterWorkspace({
  policyId,
  routing,
  onUpdate,
  readOnly = false,
}: {
  policyId: string
  routing: string
  onUpdate?: () => void
  // Closed items are meant to stay immutable -- same component, same data (status,
  // assignment, comments, activity log all still visible), but every control that
  // could change something is disabled/hidden rather than just left interactive and
  // hoping nobody clicks it.
  readOnly?: boolean
}) {
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
      const [statusRes, commentsRes, activityRes, usersRes, sessionRes] = await Promise.all([
        fetch(`/api/policies/${encodedId}/status`, { credentials: 'include' }),
        fetch(`/api/policies/${encodedId}/comments`, { credentials: 'include' }),
        fetch(`/api/policies/${encodedId}/activity`, { credentials: 'include' }),
        fetch('/api/users', { credentials: 'include' }),
        fetch('/api/session', { credentials: 'include' }),
      ])

      if (statusRes.status === 401) {
        setError('Pick an identity from "Acting as" above to view this policy.')
        return
      }
      if (statusRes.status === 403) {
        setError('This policy belongs to a different country than your acting-as session.')
        return
      }
      if (!statusRes.ok) {
        setError('Unable to load this policy.')
        return
      }

      setStatusState(await statusRes.json())
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

  const refresh = useCallback(async () => {
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
    if (readOnly || !statusState || newStatus === statusState.status) return
    setSaving(true)
    try {
      await fetch(`/api/policies/${encodeURIComponent(policyId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus, assignedUserId: statusState.assignedUserId }),
      })
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  const changeAssignment = async (newUserId: string | null) => {
    if (readOnly || !statusState) return
    setSaving(true)
    try {
      await fetch(`/api/policies/${encodeURIComponent(policyId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: statusState.status, assignedUserId: newUserId }),
      })
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  const submitComment = async () => {
    if (readOnly || !commentDraft.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/policies/${encodeURIComponent(policyId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: commentDraft.trim() }),
      })
      setCommentDraft('')
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  const userNameById = useMemo(() => {
    const map = new Map<string, string>()
    users.forEach((user) => map.set(user.id, user.name))
    return map
  }, [users])

  const transitions = routing === 'NAVINS Renew' ? NAVINS_RENEW_TRANSITIONS : MANUAL_REVIEW_TRANSITIONS
  const statusOptions = statusState ? [statusState.status, ...(transitions[statusState.status] ?? [])] : []

  if (error) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{error}</div>
  }

  if (!statusState) {
    return <div className="p-4 text-sm text-slate-500">{loading ? 'Loading…' : 'No data.'}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-6">
        {/* FILTER_WIDTH (lib/ui.ts, 2026-09-15) -- same width as Renewal Management's
            filter controls, one shared definition rather than a second w-44 written
            down here to drift from the original later. */}
        <label className={`flex flex-col gap-1 text-xs font-medium text-slate-600 ${FILTER_WIDTH}`}>
          Status
          <select
            value={statusState.status}
            onChange={(event) => changeStatus(event.target.value)}
            disabled={readOnly || saving}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-60"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <label className={`flex flex-col gap-1 text-xs font-medium text-slate-600 ${FILTER_WIDTH}`}>
          Assigned to
          <select
            value={statusState.assignedUserId ?? ''}
            onChange={(event) => changeAssignment(event.target.value || null)}
            disabled={readOnly || saving}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-60"
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </label>

        {!readOnly && !statusState.assignedUserId && currentUserId && (
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

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Comments</h3>
          <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
            {comments.length === 0 && <p className="text-sm text-slate-500">No comments yet.</p>}
            {comments.map((comment) => (
              <div key={comment.id} className="rounded-lg bg-slate-50 p-3 text-sm shadow-sm">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{userNameById.get(comment.userId) ?? comment.userId}</span>
                  <span>{formatTimestamp(comment.createdAt)}</span>
                </div>
                <p className="text-slate-800">{comment.text}</p>
              </div>
            ))}
          </div>
          {!readOnly && (
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
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Activity log</h3>
          <div className="space-y-2 rounded-md border border-slate-200 bg-white p-4">
            {activity.length === 0 && <p className="text-sm text-slate-500">No activity yet.</p>}
            {activity.map((entry) => (
              <div key={entry.id} className="rounded-lg bg-slate-50 p-3 text-sm shadow-sm">
                <div className="mb-1 text-xs text-slate-500">{formatTimestamp(entry.createdAt)}</div>
                <p className="text-slate-800">{activityDescription(entry, userNameById)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
