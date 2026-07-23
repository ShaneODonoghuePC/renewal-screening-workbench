'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EMPTY_VALUE } from '@/lib/format'

type HistoryItem = {
  id: string
  customerName: string
  renewalDate: string | null
  routing: string
  status: string
  closedAt: string | null
}

function formatDate(renewalDate: string | null) {
  if (!renewalDate) return EMPTY_VALUE
  const date = new Date(`${renewalDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatTimestamp(iso: string | null) {
  if (!iso) return EMPTY_VALUE
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<'manual' | 'navins'>('manual')

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/history', { credentials: 'include' })
      if (response.status === 401) {
        setError('Pick an identity from "Acting as" above to view history.')
        setItems([])
        return
      }
      if (!response.ok) {
        setError('Unable to load history.')
        return
      }
      setItems(await response.json())
    } catch {
      setError('Unable to load history. Check your connection.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Most recently closed/done first — the natural read order for an audit trail.
  const manualReviewItems = useMemo(
    () =>
      items
        .filter((item) => item.routing === 'Manual Review')
        .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')),
    [items]
  )
  const navinsItems = useMemo(
    () =>
      items
        .filter((item) => item.routing === 'NAVINS Renew')
        .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')),
    [items]
  )

  const visibleItems = section === 'manual' ? manualReviewItems : navinsItems

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-[40px] font-semibold leading-tight tracking-tight text-slate-900">Closed Items</h1>
          <p className="text-xs text-slate-500">
            Read-only audit trail of closed-out items. Not re-openable from here.
          </p>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">{error}</div>
      )}

      <section className="rounded-lg border border-slate-200 p-6 shadow-sm">
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
            Manual Review, Closed ({manualReviewItems.length})
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
            Navins Renew, Closed ({navinsItems.length})
          </button>
          {loading && <p className="self-center text-sm text-slate-500">Loading…</p>}
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Policy</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Renewal date</th>
                <th className="px-4 py-3 font-medium">Final status</th>
                <th className="px-4 py-3 font-medium">Date closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visibleItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-4 font-medium text-slate-900">{item.id}</td>
                  <td className="px-4 py-4 text-slate-700">{item.customerName}</td>
                  <td className="px-4 py-4 text-slate-700">{formatDate(item.renewalDate)}</td>
                  <td className="px-4 py-4 text-slate-700">{item.status}</td>
                  <td className="px-4 py-4 text-slate-700">{formatTimestamp(item.closedAt)}</td>
                </tr>
              ))}
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    {section === 'manual' ? 'No closed Manual Review items yet.' : 'No closed Navins Renew items yet.'}
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
