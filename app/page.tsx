'use client'

import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react'
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
import FlagDetailPanel, { type FlagEvidence } from '@/components/FlagDetailPanel'

type TeamItem = FlagEvidence & {
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

// The three routings the unified list mixes together, and how each displays in the
// new Routing column / Routing filter -- internal values match policies.routing
// exactly (as stored/queried), display labels match existing UI conventions elsewhere.
const ROUTING_OPTIONS = ['Manual Review', 'NAVINS Renew', 'RPUX Auto Renew'] as const
type Routing = (typeof ROUTING_OPTIONS)[number]
const ROUTING_LABELS: Record<Routing, string> = {
  'Manual Review': 'Manual Review',
  'NAVINS Renew': 'Navins Renew',
  'RPUX Auto Renew': 'RPUX Auto-Renew',
}

// The Routing filter's own option set adds an "All" choice on top of the three real
// routings -- default selection, superseding the old Manual Review + Navins Renew
// default from the previous round.
type RoutingFilterOption = 'all' | Routing
const ROUTING_FILTER_OPTIONS: readonly RoutingFilterOption[] = ['all', ...ROUTING_OPTIONS]
const ROUTING_FILTER_LABELS: Record<RoutingFilterOption, string> = { all: 'All', ...ROUTING_LABELS }

// The extended Status filter's three buckets, replacing the old per-routing literal-
// status dropdown (Not Started/In Review/With Broker vs. Not Started/Quote Sent/Policy
// Sent) -- those differ by routing, so once rows of different routings are mixed in one
// table, a routing-agnostic bucket is the only filter that still makes sense. Same
// grouping the table's Status cell already displayed via the old collapseStatus().
const STATUS_BUCKETS = ['not-started', 'started', 'closed'] as const
type StatusBucket = (typeof STATUS_BUCKETS)[number]
const STATUS_BUCKET_LABELS: Record<StatusBucket, string> = {
  'not-started': 'Not Started',
  started: 'Started',
  closed: 'Closed',
}

// Same "All" addition as the Routing filter -- default selection, superseding the old
// Started + Not Started default from the previous round.
type StatusFilterOption = 'all' | StatusBucket
const STATUS_FILTER_OPTIONS: readonly StatusFilterOption[] = ['all', ...STATUS_BUCKETS]
const STATUS_FILTER_LABELS: Record<StatusFilterOption, string> = { all: 'All', ...STATUS_BUCKET_LABELS }

const ATTENTION_OPTIONS = ['High', 'Medium', 'None']

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

// RPUX Auto Renew has no review_states row at all, so Status filtering genuinely
// doesn't apply to it -- callers check `item.routing === 'RPUX Auto Renew'` separately
// rather than relying on this returning null for that case.
function getStatusBucket(item: TeamItem): StatusBucket {
  if (isTerminalStatus(item.routing, item.status)) return 'closed'
  if (!item.status || item.status === 'Not Started') return 'not-started'
  return 'started'
}

type RowKind = 'auto-renew' | 'closed' | 'workspace'

function getRowKind(item: TeamItem): RowKind {
  if (item.routing === 'RPUX Auto Renew') return 'auto-renew'
  if (getStatusBucket(item) === 'closed') return 'closed'
  return 'workspace'
}

// Same checkbox-dropdown idiom for Routing, Status, and Flag type -- one implementation
// instead of three near-identical copies (each previously would have needed its own
// open state, outside-click handling, and checkbox list markup).
function MultiSelectDropdown<T extends string>({
  label,
  options,
  optionLabel,
  selected,
  onChange,
  allValue,
}: {
  label: string
  options: readonly T[]
  optionLabel?: (option: T) => string
  selected: Set<T>
  onChange: (next: Set<T>) => void
  // When set, this option is a mutually-exclusive "everything" choice: checking it
  // clears every other selection, checking anything else while it's active clears it
  // instead, and clearing back down to nothing falls back to it rather than leaving
  // the filter selecting zero items.
  allValue?: T
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const toggle = (option: T) => {
    const next = new Set(selected)
    if (next.has(option)) next.delete(option)
    else next.add(option)

    if (allValue == null) {
      onChange(next)
      return
    }

    const prevHasAll = selected.has(allValue)
    const nextHasAll = next.has(allValue)
    if (nextHasAll && !prevHasAll) {
      // Just checked "All" -- it wins outright, drop everything else.
      onChange(new Set([allValue]))
      return
    }
    // Either a specific option was toggled (possibly while "All" was active, in which
    // case it should fall away), or "All" itself was unchecked -- either way, drop
    // "All" from the result and fall back to it only if nothing else is left selected.
    const cleaned = new Set(next)
    cleaned.delete(allValue)
    onChange(cleaned.size > 0 ? cleaned : new Set([allValue]))
  }

  const isAllSelected = allValue != null && selected.size === 1 && selected.has(allValue)
  const buttonLabel = isAllSelected || selected.size === 0 ? label : `${label} (${selected.size})`

  return (
    <div className="relative flex flex-col gap-1 text-xs font-medium text-slate-600" ref={ref}>
      <span>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
      >
        <span>{buttonLabel}</span>
        <span className="text-slate-400" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {options.map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={selected.has(option)}
                onChange={() => toggle(option)}
                className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-slate-300"
              />
              {optionLabel ? optionLabel(option) : option}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// Renewal Management: Manual Review, Navins Renew, RPUX Auto-Renew, and Closed Items
// consolidated into one filterable list (Routing + Status do the work the four old
// separate pages used to do), replacing what used to be Assignment & Management plus
// the standalone Auto-Renew Log and Closed Items pages.
export default function TeamViewPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [items, setItems] = useState<TeamItem[]>([])
  const [users, setUsers] = useState<Identity[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Both default to "All" -- supersedes the previous round's Manual Review + Navins
  // Renew / Started + Not Started defaults (which matched the old Assignment &
  // Management page). Deliberate reversal: nothing is hidden on first load now.
  const [routingFilter, setRoutingFilter] = useState<Set<RoutingFilterOption>>(new Set(['all']))
  const [statusFilter, setStatusFilter] = useState<Set<StatusFilterOption>>(new Set(['all']))
  const [attentionFilter, setAttentionFilter] = useState('')
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

  const pageDefaultMonth = 'all'
  const monthParam = searchParams.get('month')

  // Structural filters (Routing + Status) applied first -- these are what the month
  // tabs and the table both key off. RPUX Auto-Renew ignores the Status filter
  // entirely and shows whenever its Routing checkbox is on, per spec.
  const structurallyFilteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (!routingFilter.has('all') && !routingFilter.has(item.routing as Routing)) return false
        if (item.routing === 'RPUX Auto Renew') return true
        return statusFilter.has('all') || statusFilter.has(getStatusBucket(item))
      }),
    [items, routingFilter, statusFilter]
  )

  const { tabs } = useMemo(() => buildMonthTabs(structurallyFilteredItems), [structurallyFilteredItems])
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
    if (selectedMonth === 'all') return structurallyFilteredItems
    return structurallyFilteredItems.filter((item) => {
      const derived = deriveRenewalMonth(item.renewalDate)
      if (!derived) return false
      const key = `${derived.year}-${String(derived.month).padStart(2, '0')}`
      return key === selectedMonth
    })
  }, [structurallyFilteredItems, selectedMonth])

  // Summary strip: month-scoped only, independent of every filter below (Routing and
  // Status included) -- an at-a-glance overview of the whole month's caseload that
  // never shifts as filters are toggled, computed the same way it always was so the
  // numbers here can't regress from what Assignment & Management used to show.
  const summaryMonthItems = useMemo(() => {
    if (selectedMonth === 'all') return items
    return items.filter((item) => {
      const derived = deriveRenewalMonth(item.renewalDate)
      if (!derived) return false
      const key = `${derived.year}-${String(derived.month).padStart(2, '0')}`
      return key === selectedMonth
    })
  }, [items, selectedMonth])

  const summary = useMemo(() => {
    const manual = summaryMonthItems.filter((item) => item.routing === 'Manual Review' && !isTerminalStatus(item.routing, item.status))
    const navins = summaryMonthItems.filter((item) => item.routing === 'NAVINS Renew' && !isTerminalStatus(item.routing, item.status))
    const autoRenew = summaryMonthItems.filter((item) => item.routing === 'RPUX Auto Renew')
    // Same "closed" bucket the Status filter uses (getStatusBucket), not a separate
    // definition -- RPUX Auto-Renew items never come back closed (no status at all),
    // so this only ever counts Manual Review/Navins Renew.
    const closed = summaryMonthItems.filter((item) => getStatusBucket(item) === 'closed')
    const totalFlagsRaised = manual.reduce((sum, item) => sum + flagList(item.flagReasons).length, 0)
    return {
      totalRenewals: manual.length + navins.length + autoRenew.length,
      autoRenewCount: autoRenew.length,
      navinsCount: navins.length,
      manualReviewCount: manual.length,
      closedCount: closed.length,
      totalFlagsRaised,
    }
  }, [summaryMonthItems])

  // Available flags/brokers scoped to the structurally-filtered, month-filtered set --
  // same "pre-refinement-filter" scoping the old page used, just no longer limited to
  // the Manual Review tab now that flags/brokers can come from any visible routing.
  const availableFlags = useMemo(() => {
    const set = new Set<string>()
    monthFilteredItems.forEach((item) => flagList(item.flagReasons).forEach((flag) => set.add(flag)))
    return [...set].sort()
  }, [monthFilteredItems])

  const availableBrokers = useMemo(() => {
    const set = new Set<string>()
    monthFilteredItems.forEach((item) => {
      if (item.brokerName) set.add(item.brokerName)
    })
    return [...set].sort()
  }, [monthFilteredItems])

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

  const filteredItems = useMemo(() => {
    let result = monthFilteredItems
    if (attentionFilter) result = result.filter((item) => (item.attention || 'None') === attentionFilter)
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
  }, [monthFilteredItems, attentionFilter, assignedFilter, brokerFilter, flagFilter, sortItems])

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

  return (
    <>
    <div className="space-y-6">
      {/* No H1 here -- the "Renewal Management" nav link is the only destination now,
          so it alone identifies the page. */}

      {/* Month picker: the first thing to interact with, since the time period being
          viewed should be obvious at a glance. */}
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

      {/* Summary strip: month-scoped overview, independent of the filters below.
          Left-aligned under the Month picker, not spread across the full width. */}
      <section className="flex flex-wrap gap-x-8 gap-y-3">
        <StatTile label="Total renewals" value={summary.totalRenewals} />
        <StatTile label="Auto-renew" value={summary.autoRenewCount} />
        <StatTile label="Navins Renew" value={summary.navinsCount} />
        <StatTile label="Manual Review" value={summary.manualReviewCount} />
        <StatTile label="Closed" value={summary.closedCount} />
        <StatTile label="Total flags raised" value={summary.totalFlagsRaised} />
      </section>

      <section className="rounded-lg border border-slate-200 p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <MultiSelectDropdown
            label="Routing"
            options={ROUTING_FILTER_OPTIONS}
            optionLabel={(r) => ROUTING_FILTER_LABELS[r]}
            selected={routingFilter}
            onChange={(next) => setRoutingFilter(next)}
            allValue="all"
          />

          <MultiSelectDropdown
            label="Status"
            options={STATUS_FILTER_OPTIONS}
            optionLabel={(s) => STATUS_FILTER_LABELS[s]}
            selected={statusFilter}
            onChange={(next) => setStatusFilter(next)}
            allValue="all"
          />

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

          {availableFlags.length > 0 && (
            <MultiSelectDropdown
              label="Flag type"
              options={availableFlags}
              selected={new Set(flagFilter)}
              onChange={(next) => setFlagFilter([...next])}
            />
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

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium"></th>
                <th className="px-4 py-3 font-medium">Routing</th>
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
              {filteredItems.map((item) => {
                const isExpanded = expandedRows.has(item.id)
                const kind = getRowKind(item)
                const isAutoRenew = kind === 'auto-renew'
                return (
                  <Fragment key={item.id}>
                    <tr
                      onClick={() => toggleExpanded(item.id)}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${item.id}`}
                      className="cursor-pointer hover:bg-slate-100"
                    >
                      <td className="px-4 py-4">
                        <ExpandCaret expanded={isExpanded} />
                      </td>
                      <td className="px-4 py-4 text-slate-700">{ROUTING_LABELS[item.routing as Routing] ?? item.routing}</td>
                      <td className="px-4 py-4 font-medium text-slate-900">{item.id}</td>
                      <td className="px-4 py-4 text-slate-700">{item.customerName}</td>
                      <td className="px-4 py-4 text-slate-700">{item.brokerName || EMPTY_VALUE}</td>
                      <td className="px-4 py-4"><SeverityBadge attention={item.attention} /></td>
                      <td className="px-4 py-4 text-slate-700">{isAutoRenew ? EMPTY_VALUE : STATUS_BUCKET_LABELS[getStatusBucket(item)]}</td>
                      <td className="px-4 py-4 text-slate-700">{formatDate(item.renewalDate)}</td>
                      <td className="px-4 py-4 text-slate-700">
                        {isAutoRenew ? EMPTY_VALUE : item.assignedUserId ? userNameById.get(item.assignedUserId) ?? item.assignedUserId : 'Unassigned'}
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        {kind === 'workspace' && (
                          <div className="flex flex-col gap-1">
                            {item.routing === 'Manual Review' && (
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
                            )}
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
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={10} className="bg-slate-50 px-6 py-5">
                          {kind === 'auto-renew' && (
                            <FlagDetailPanel
                              item={item}
                              stage1Heading="Operational Review Flags (all clear)"
                              stage2Heading="Company & Financial Flags (all clear)"
                            />
                          )}
                          {kind === 'closed' && (
                            <>
                              <h3 className="mb-3 text-sm font-semibold text-slate-900">Underwriter Workspace (Closed — read-only)</h3>
                              <UnderwriterWorkspace policyId={item.id} routing={item.routing} onUpdate={loadAll} readOnly />
                            </>
                          )}
                          {kind === 'workspace' && (
                            <>
                              <h3 className="mb-3 text-sm font-semibold text-slate-900">Underwriter Workspace</h3>
                              <UnderwriterWorkspace policyId={item.id} routing={item.routing} onUpdate={loadAll} />
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                    No items match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>

      {/* Deliberately outside the space-y-6 wrapper above: that utility puts a
          margin-top on every child after the first, and since SlideOutPanel is a
          position:fixed overlay, the margin still applied to it (fixed elements
          respect their own margin same as anything else) -- pushing the whole
          panel down and leaving a gap above it despite h-screen. Sibling of the
          wrapper instead of a child of it, so it never picks up that spacing.
          No title prop -- RiskQualityPanel renders its own "Risk Assessment" header
          (title + rating-explanation subtext inline together), so the slide-out chrome
          stays to just the Close button rather than showing a second, separate title. */}
      <SlideOutPanel open={reviewPolicyId !== null} onClose={() => setReviewPolicyId(null)}>
        {reviewPolicyId && <RiskQualityPanel policyId={reviewPolicyId} />}
      </SlideOutPanel>
    </>
  )
}
