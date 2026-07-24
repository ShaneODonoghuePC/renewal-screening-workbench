'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { deriveRenewalMonth } from '@/lib/renewalMonth'
import { buildMonthTabs } from '@/lib/monthTabs'
import { isTerminalStatus } from '@/lib/statusWorkflow'
import { EMPTY_VALUE } from '@/lib/format'
import SeverityBadge from '@/components/SeverityBadge'
import SlideOutPanel from '@/components/SlideOutPanel'
import RiskQualityPanel from '@/components/RiskQualityPanel'
import UnderwriterWorkspace from '@/components/UnderwriterWorkspace'
import ExpandCaret from '@/components/ExpandCaret'
import StatTile from '@/components/StatTile'

type TeamItem = {
  id: string
  customerName: string
  brokerName: string | null
  premium: number | null
  attention: string | null
  flagReasons: string | null
  renewalDate: string | null
  routing: string
  status: string | null
  assignedUserId: string | null
}

type Identity = { id: string; name: string; country: string }

const ATTENTION_OPTIONS = ['High', 'Medium', 'None']
// Terminal statuses (Renewed/Not Renewed/Quote Declined) never appear here -- they move
// to Closed Items instead -- so they aren't offered as filter options; they'd always
// return nothing.
const MANUAL_REVIEW_STATUSES = ['Not Started', 'In Review', 'With Broker']
const NAVINS_STATUSES = ['Not Started', 'Quote Sent', 'Policy Sent']

function formatDate(renewalDate: string | null) {
  if (!renewalDate) return EMPTY_VALUE
  const date = new Date(`${renewalDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function attentionRank(attention: string | null) {
  if (attention === 'High') return 1
  if (attention === 'Medium') return 2
  return 3
}

function flagList(flagReasons: string | null) {
  if (!flagReasons) return []
  return flagReasons.split(',').map((s) => s.trim()).filter(Boolean)
}

// Table-level display only (Phase 2A): the real, specific state (In Review/With Broker/
// Quote Sent/Policy Sent) is visible once a row is expanded, inside the Underwriter
// Workspace status control -- the collapsed table just shows whether work has begun.
function collapseStatus(status: string | null) {
  if (!status) return EMPTY_VALUE
  return status === 'Not Started' ? 'Not Started' : 'Started'
}

export default function TeamViewPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [items, setItems] = useState<TeamItem[]>([])
  const [users, setUsers] = useState<Identity[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [section, setSection] = useState<'manual' | 'navins'>('manual')
  const [attentionFilter, setAttentionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [brokerFilter, setBrokerFilter] = useState('')
  const [flagFilter, setFlagFilter] = useState<string[]>([])
  const [sortField, setSortField] = useState<'renewalDate' | 'attention' | 'status'>('renewalDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  // "Assigned to" defaults to the acting-as user (replaces My Queue's personal-view role) —
  // applied once per identity, not re-forced if the user deliberately switches it to "All"/someone else.
  const [defaultFilterApplied, setDefaultFilterApplied] = useState(false)
  const [reviewPolicyId, setReviewPolicyId] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [flagDropdownOpen, setFlagDropdownOpen] = useState(false)
  const flagDropdownRef = useRef<HTMLDivElement>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [teamRes, usersRes, sessionRes] = await Promise.all([
        fetch('/api/team', { credentials: 'include' }),
        fetch('/api/users', { credentials: 'include' }),
        fetch('/api/session', { credentials: 'include' }),
      ])
      if (teamRes.status === 401 || usersRes.status === 401) {
        setError('Pick an identity from "Acting as" above to view the team queue.')
        setItems([])
        setUsers([])
        return
      }
      if (!teamRes.ok || !usersRes.ok) {
        setError('Unable to load team data.')
        return
      }
      const teamData: TeamItem[] = await teamRes.json()
      const usersData: Identity[] = await usersRes.json()
      setItems(teamData)
      setUsers(usersData)
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json()
        setCurrentUserId(sessionData.userId)
      } else {
        setCurrentUserId(null)
      }
    } catch {
      setError('Unable to load team data. Check your connection.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (currentUserId && !defaultFilterApplied) {
      setAssignedFilter(currentUserId)
      setDefaultFilterApplied(true)
    }
  }, [currentUserId, defaultFilterApplied])

  // Close the Flag type dropdown on outside click.
  useEffect(() => {
    if (!flagDropdownOpen) return
    const handleClick = (event: MouseEvent) => {
      if (flagDropdownRef.current && !flagDropdownRef.current.contains(event.target as Node)) {
        setFlagDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [flagDropdownOpen])

  // Tabs are scoped to Manual Review + Navins Renew only (what the tables below actually
  // show) — Auto Renew rows are in `items` purely for the summary strip's auto-renew
  // count and shouldn't shift month labels/counts.
  const teamOnlyItems = useMemo(() => items.filter((item) => item.routing !== 'RPUX Auto Renew'), [items])
  const { tabs } = useMemo(() => buildMonthTabs(teamOnlyItems), [teamOnlyItems])

  // Assignment & Management defaults to "All" rather than buildMonthTabs's own
  // soonest-outstanding-month default (which Auto-Renew Log still uses) — overridden
  // here at the call site rather than in the shared helper, since the two pages want
  // different defaults.
  const pageDefaultMonth = 'all'

  const monthParam = searchParams.get('month')
  const selectedMonth = monthParam && tabs.some((tab) => tab.value === monthParam) ? monthParam : pageDefaultMonth

  // Reflect the resolved default in the URL once data is loaded, without adding a history entry.
  useEffect(() => {
    if (!monthParam && items.length > 0) {
      router.replace(`${pathname}?month=${pageDefaultMonth}`)
    }
  }, [monthParam, items.length, pathname, router])

  const handleSelectMonth = (value: string) => {
    router.push(`${pathname}?month=${value}`)
  }

  const monthFilteredItems = useMemo(() => {
    if (selectedMonth === 'all') return items
    return items.filter((item) => {
      const derived = deriveRenewalMonth(item.renewalDate)
      if (!derived) return false
      const key = `${derived.year}-${String(derived.month).padStart(2, '0')}`
      return key === selectedMonth
    })
  }, [items, selectedMonth])

  // Terminal items (Renewed/Not Renewed for Manual Review; Quote Declined/Renewed/Not
  // Renewed for Navins Renew) are filtered out here — a display change only: the
  // underlying data/status is untouched, they just move to Closed Items instead of
  // staying visible in the working queues.
  const manualReviewItems = useMemo(
    () => monthFilteredItems.filter((item) => item.routing === 'Manual Review' && !isTerminalStatus(item.routing, item.status)),
    [monthFilteredItems]
  )
  const navinsItems = useMemo(
    () => monthFilteredItems.filter((item) => item.routing === 'NAVINS Renew' && !isTerminalStatus(item.routing, item.status)),
    [monthFilteredItems]
  )
  const autoRenewItems = useMemo(
    () => monthFilteredItems.filter((item) => item.routing === 'RPUX Auto Renew'),
    [monthFilteredItems]
  )

  // Summary strip counts — scoped to the selected month only, independent of the
  // Attention/Status/Assigned-to filters below (an at-a-glance overview of the whole
  // month's caseload, not whichever narrow slice happens to be currently filtered).
  // Counts reflect the same open-items filtering as the tables (terminal items excluded)
  // so the tiles and tables never disagree with each other.
  const summary = useMemo(() => {
    const totalFlagsRaised = manualReviewItems.reduce((sum, item) => sum + flagList(item.flagReasons).length, 0)
    return {
      totalRenewals: manualReviewItems.length + navinsItems.length + autoRenewItems.length,
      autoRenewCount: autoRenewItems.length,
      navinsCount: navinsItems.length,
      manualReviewCount: manualReviewItems.length,
      totalFlagsRaised,
    }
  }, [autoRenewItems, navinsItems, manualReviewItems])

  const availableFlags = useMemo(() => {
    const set = new Set<string>()
    manualReviewItems.forEach((item) => flagList(item.flagReasons).forEach((flag) => set.add(flag)))
    return [...set].sort()
  }, [manualReviewItems])

  // Broker options scoped to whichever table is currently active, same as Flag type's
  // availableFlags -- populated from the month-filtered, pre-other-filter item list.
  const availableBrokers = useMemo(() => {
    const sourceItems = section === 'manual' ? manualReviewItems : navinsItems
    const set = new Set<string>()
    sourceItems.forEach((item) => {
      if (item.brokerName) set.add(item.brokerName)
    })
    return [...set].sort()
  }, [section, manualReviewItems, navinsItems])

  const sortItems = useCallback(
    (list: TeamItem[]) => {
      const sorted = [...list].sort((a, b) => {
        let cmp = 0
        if (sortField === 'renewalDate') {
          cmp = (a.renewalDate ?? '').localeCompare(b.renewalDate ?? '')
        } else if (sortField === 'attention') {
          cmp = attentionRank(a.attention) - attentionRank(b.attention)
        } else {
          cmp = (a.status ?? '').localeCompare(b.status ?? '')
        }
        return sortDir === 'asc' ? cmp : -cmp
      })
      return sorted
    },
    [sortField, sortDir]
  )

  const filteredManualReview = useMemo(() => {
    let result = manualReviewItems
    if (attentionFilter) result = result.filter((item) => (item.attention || 'None') === attentionFilter)
    if (statusFilter) result = result.filter((item) => item.status === statusFilter)
    if (assignedFilter === 'unassigned') result = result.filter((item) => !item.assignedUserId)
    else if (assignedFilter) result = result.filter((item) => item.assignedUserId === assignedFilter)
    if (brokerFilter) result = result.filter((item) => item.brokerName === brokerFilter)
    if (flagFilter.length > 0) {
      result = result.filter((item) => {
        const flags = flagList(item.flagReasons)
        return flagFilter.some((flag) => flags.includes(flag))
      })
    }
    return sortItems(result)
  }, [manualReviewItems, attentionFilter, statusFilter, assignedFilter, brokerFilter, flagFilter, sortItems])

  const filteredNavins = useMemo(() => {
    let result = navinsItems
    if (statusFilter) result = result.filter((item) => item.status === statusFilter)
    if (assignedFilter === 'unassigned') result = result.filter((item) => !item.assignedUserId)
    else if (assignedFilter) result = result.filter((item) => item.assignedUserId === assignedFilter)
    if (brokerFilter) result = result.filter((item) => item.brokerName === brokerFilter)
    return sortItems(result)
  }, [navinsItems, statusFilter, assignedFilter, brokerFilter, sortItems])

  const userNameById = useMemo(() => {
    const map = new Map<string, string>()
    users.forEach((user) => map.set(user.id, user.name))
    return map
  }, [users])

  const updatePolicy = async (id: string, status: string, assignedUserId: string | null) => {
    const response = await fetch(`/api/policies/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status, assignedUserId }),
    })
    if (!response.ok) return
    const updated = await response.json()
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: updated.status, assignedUserId: updated.assignedUserId } : item
      )
    )
  }

  const toggleExpanded = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const statusOptions = section === 'manual' ? MANUAL_REVIEW_STATUSES : NAVINS_STATUSES

  return (
    <div className="space-y-6">
      <h1 className="text-[40px] font-semibold leading-tight tracking-tight text-slate-900">Assignment & Management</h1>

      {/* Month picker: the first thing to interact with, since the time period being
          viewed should be obvious at a glance -- pulled out of the filter bar below and
          defaulted to "All" (a page-level override; see pageDefaultMonth above). */}
      <section className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          Month
          <select
            value={selectedMonth}
            onChange={(event) => handleSelectMonth(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          >
            {tabs.map((tab) => (
              <option key={tab.value} value={tab.value}>{tab.label}</option>
            ))}
          </select>
        </label>
      </section>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">{error}</div>
      )}

      {/* Summary strip: month-scoped overview, independent of the filters below */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Total renewals" value={summary.totalRenewals} />
        <StatTile label="Auto-renew" value={summary.autoRenewCount} />
        <StatTile label="Navins Renew" value={summary.navinsCount} />
        <StatTile label="Manual Review" value={summary.manualReviewCount} />
        <StatTile label="Total flags raised" value={summary.totalFlagsRaised} />
      </section>

      <section className="rounded-lg border border-slate-200 p-6 shadow-sm">
        {/* Hierarchy: Manual Review/Navins Renew tabs -> filters (incl. month) -> table */}
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setSection('manual')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
              section === 'manual'
                ? 'bg-brand text-white active:bg-brand-dark'
                : 'bg-white text-slate-700 border border-slate-200 active:bg-slate-100'
            }`}
          >
            Manual Review ({manualReviewItems.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('navins')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
              section === 'navins'
                ? 'bg-brand text-white active:bg-brand-dark'
                : 'bg-white text-slate-700 border border-slate-200 active:bg-slate-100'
            }`}
          >
            Navins Renew ({navinsItems.length})
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-4">
          {section === 'manual' && (
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Attention
              <select
                value={attentionFilter}
                onChange={(event) => setAttentionFilter(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">All</option>
                {ATTENTION_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">All</option>
              {statusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Assigned to
            <select
              value={assignedFilter}
              onChange={(event) => setAssignedFilter(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">All</option>
              <option value="unassigned">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Broker
            <select
              value={brokerFilter}
              onChange={(event) => setBrokerFilter(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">All</option>
              {availableBrokers.map((broker) => (
                <option key={broker} value={broker}>{broker}</option>
              ))}
            </select>
          </label>

          {section === 'manual' && availableFlags.length > 0 && (
            <div className="relative flex flex-col gap-1 text-xs font-medium text-slate-600" ref={flagDropdownRef}>
              <span>Flag type</span>
              <button
                type="button"
                onClick={() => setFlagDropdownOpen((open) => !open)}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              >
                <span>{flagFilter.length > 0 ? `Flag type (${flagFilter.length})` : 'Flag type'}</span>
                <span className="text-slate-400" aria-hidden="true">▾</span>
              </button>
              {flagDropdownOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                  {availableFlags.map((flag) => (
                    <label
                      key={flag}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={flagFilter.includes(flag)}
                        onChange={() =>
                          setFlagFilter((prev) => (prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-slate-300"
                      />
                      {flag}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Sort by
            <select
              value={sortField}
              onChange={(event) => setSortField(event.target.value as typeof sortField)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            >
              <option value="renewalDate">Renewal date</option>
              <option value="attention">Attention</option>
              <option value="status">Status</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {sortDir === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
          </button>

          {loading && <p className="text-sm text-slate-500">Loading…</p>}
        </div>

        {section === 'manual' ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium"></th>
                  <th className="px-4 py-3 font-medium">Policy</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Broker</th>
                  <th className="px-4 py-3 font-medium">Attention</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Renewal date</th>
                  <th className="px-4 py-3 font-medium">Assigned to</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredManualReview.map((item) => {
                  const isExpanded = expandedRows.has(item.id)
                  return (
                    <>
                      <tr
                        key={item.id}
                        onClick={() => toggleExpanded(item.id)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} Underwriter Workspace for ${item.id}`}
                        className="cursor-pointer hover:bg-slate-100"
                      >
                        <td className="px-4 py-4">
                          <ExpandCaret expanded={isExpanded} />
                        </td>
                        <td className="px-4 py-4 font-medium text-slate-900">{item.id}</td>
                        <td className="px-4 py-4 text-slate-700">{item.customerName}</td>
                        <td className="px-4 py-4 text-slate-700">{item.brokerName || EMPTY_VALUE}</td>
                        <td className="px-4 py-4"><SeverityBadge attention={item.attention} /></td>
                        <td className="px-4 py-4 text-slate-700">{collapseStatus(item.status)}</td>
                        <td className="px-4 py-4 text-slate-700">{formatDate(item.renewalDate)}</td>
                        <td className="px-4 py-4 text-slate-700">
                          {item.assignedUserId ? userNameById.get(item.assignedUserId) ?? item.assignedUserId : 'Unassigned'}
                        </td>
                        <td className="px-4 py-4 text-slate-700">
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                setReviewPolicyId(item.id)
                              }}
                              className="rounded-lg border border-brand px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/5 active:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                            >
                              Review
                            </button>
                            {!item.assignedUserId && currentUserId && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  updatePolicy(item.id, item.status ?? 'Not Started', currentUserId)
                                }}
                                className="rounded-lg bg-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand-dark active:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                              >
                                Assign to me
                              </button>
                            )}
                            <select
                              value={item.assignedUserId ?? ''}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                event.stopPropagation()
                                updatePolicy(item.id, item.status ?? 'Not Started', event.target.value || null)
                              }}
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                            >
                              <option value="">Unassigned</option>
                              {users.map((user) => (
                                <option key={user.id} value={user.id}>{user.name}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${item.id}-expanded`}>
                          <td colSpan={9} className="bg-slate-50 px-6 py-5">
                            <h3 className="mb-3 text-sm font-semibold text-slate-900">Underwriter Workspace</h3>
                            <UnderwriterWorkspace policyId={item.id} routing={item.routing} onUpdate={loadAll} />
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
                {filteredManualReview.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                      No Manual Review items match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium"></th>
                  <th className="px-4 py-3 font-medium">Policy</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Broker</th>
                  <th className="px-4 py-3 font-medium">Renewal date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Assigned to</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredNavins.map((item) => {
                  const isExpanded = expandedRows.has(item.id)
                  return (
                    <>
                      <tr
                        key={item.id}
                        onClick={() => toggleExpanded(item.id)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} Underwriter Workspace for ${item.id}`}
                        className="cursor-pointer hover:bg-slate-100"
                      >
                        <td className="px-4 py-4">
                          <ExpandCaret expanded={isExpanded} />
                        </td>
                        <td className="px-4 py-4 font-medium text-slate-900">{item.id}</td>
                        <td className="px-4 py-4 text-slate-700">{item.customerName}</td>
                        <td className="px-4 py-4 text-slate-700">{item.brokerName || EMPTY_VALUE}</td>
                        <td className="px-4 py-4 text-slate-700">{formatDate(item.renewalDate)}</td>
                        <td className="px-4 py-4 text-slate-700">{collapseStatus(item.status)}</td>
                        <td className="px-4 py-4 text-slate-700">
                          {item.assignedUserId ? userNameById.get(item.assignedUserId) ?? item.assignedUserId : 'Unassigned'}
                        </td>
                        <td className="px-4 py-4 text-slate-700">
                          <div className="flex flex-col gap-1">
                            {!item.assignedUserId && currentUserId && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  updatePolicy(item.id, item.status ?? 'Not Started', currentUserId)
                                }}
                                className="rounded-lg bg-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand-dark active:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                              >
                                Assign to me
                              </button>
                            )}
                            <select
                              value={item.assignedUserId ?? ''}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                event.stopPropagation()
                                updatePolicy(item.id, item.status ?? 'Not Started', event.target.value || null)
                              }}
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                            >
                              <option value="">Unassigned</option>
                              {users.map((user) => (
                                <option key={user.id} value={user.id}>{user.name}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${item.id}-expanded`}>
                          <td colSpan={8} className="bg-slate-50 px-6 py-5">
                            <h3 className="mb-3 text-sm font-semibold text-slate-900">Underwriter Workspace</h3>
                            <UnderwriterWorkspace policyId={item.id} routing={item.routing} onUpdate={loadAll} />
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
                {filteredNavins.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                      No Navins Renew items match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SlideOutPanel open={reviewPolicyId !== null} onClose={() => setReviewPolicyId(null)} title="Risk Quality & Recommendation">
        {reviewPolicyId && <RiskQualityPanel policyId={reviewPolicyId} />}
      </SlideOutPanel>
    </div>
  )
}
