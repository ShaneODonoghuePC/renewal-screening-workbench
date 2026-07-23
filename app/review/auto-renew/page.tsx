'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { deriveRenewalMonth } from '@/lib/renewalMonth'
import { buildMonthTabs } from '@/lib/monthTabs'
import { formatCurrency, EMPTY_VALUE } from '@/lib/format'
import MonthTabBar from '@/components/MonthTabBar'
import FlagDetailPanel, { type FlagEvidence } from '@/components/FlagDetailPanel'
import ExpandCaret from '@/components/ExpandCaret'

type PolicyFull = FlagEvidence & {
  id: string
  customerName: string
  renewalDate: string | null
  premium: number | null
  routing: string | null
}

function formatDate(renewalDate: string | null) {
  if (!renewalDate) return EMPTY_VALUE
  const date = new Date(`${renewalDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export default function AutoRenewLogPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [items, setItems] = useState<PolicyFull[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/policies', { credentials: 'include' })
      if (response.status === 401) {
        setError('Pick an identity from "Acting as" above to view the Auto-Renew Log.')
        setItems([])
        return
      }
      if (!response.ok) {
        setError('Unable to load the Auto-Renew Log.')
        return
      }
      const data: PolicyFull[] = await response.json()
      setItems(data.filter((item) => item.routing === 'RPUX Auto Renew'))
    } catch {
      setError('Unable to load the Auto-Renew Log. Check your connection.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // These policies have no review_states row (no status concept at all) — pass a
  // placeholder that never matches a terminal status so buildMonthTabs just defaults
  // to the earliest month, which is the sensible read-only default here.
  const { tabs, defaultMonth } = useMemo(
    () => buildMonthTabs(items.map((item) => ({ renewalDate: item.renewalDate, status: 'N/A' }))),
    [items]
  )

  const monthParam = searchParams.get('month')
  const selectedMonth = monthParam && tabs.some((tab) => tab.value === monthParam) ? monthParam : defaultMonth

  useEffect(() => {
    if (!monthParam && items.length > 0) {
      router.replace(`${pathname}?month=${defaultMonth}`)
    }
  }, [monthParam, items.length, defaultMonth, pathname, router])

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

  const visibleItems = useMemo(() => {
    if (!search.trim()) return monthFilteredItems
    const needle = search.trim().toLowerCase()
    return monthFilteredItems.filter((item) => item.customerName.toLowerCase().includes(needle))
  }, [monthFilteredItems, search])

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-[40px] font-semibold leading-tight tracking-tight text-slate-900">Auto-Renew (RPUX) Log</h1>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">{error}</div>
      )}

      {tabs.length > 0 && <MonthTabBar tabs={tabs} selected={selectedMonth} onSelect={handleSelectMonth} />}

      <section className="rounded-lg border border-slate-200 p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Search customer
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Customer name…"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </label>
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium"></th>
                <th className="px-4 py-3 font-medium">Policy</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Renewal date</th>
                <th className="px-4 py-3 font-medium">Premium</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visibleItems.map((item) => {
                const isExpanded = expanded.has(item.id)
                return (
                  <Fragment key={item.id}>
                    <tr
                      onClick={() => toggleExpanded(item.id)}
                      className="cursor-pointer hover:bg-slate-50"
                    >
                      <td className="px-4 py-4"><ExpandCaret expanded={isExpanded} /></td>
                      <td className="px-4 py-4 font-medium text-slate-900">{item.id}</td>
                      <td className="px-4 py-4 text-slate-700">{item.customerName}</td>
                      <td className="px-4 py-4 text-slate-700">{formatDate(item.renewalDate)}</td>
                      <td className="px-4 py-4 text-slate-700">{formatCurrency(item.premium, item.currency)}</td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} className="bg-slate-50 px-6 py-5">
                          <FlagDetailPanel
                            item={item}
                            stage1Heading="Stage 1 flags (all clear)"
                            stage2Heading="Stage 2 flags (all clear)"
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    No auto-renewed policies match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
