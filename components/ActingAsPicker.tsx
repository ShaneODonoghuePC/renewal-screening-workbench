'use client'

import { useEffect, useState } from 'react'

type Identity = { id: string; name: string; country: string }
type Session = { userId: string; country: string }

export default function ActingAsPicker() {
  const [identities, setIdentities] = useState<Identity[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/identities', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : []))
      .then(setIdentities)
      .catch(() => setIdentities([]))

    fetch('/api/session', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then(setSession)
      .catch(() => setSession(null))
  }, [])

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const userId = event.target.value
    if (!userId) return
    setLoading(true)
    try {
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
        credentials: 'include',
      })
      window.location.reload()
    } catch {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">Acting as:</span>
      <select
        value={session?.userId ?? ''}
        onChange={handleChange}
        disabled={loading}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-60"
      >
        <option value="" disabled>
          {loading ? 'Switching…' : 'Select an underwriter…'}
        </option>
        {identities.map((identity) => (
          <option key={identity.id} value={identity.id}>
            {identity.name} ({identity.country})
          </option>
        ))}
      </select>
    </div>
  )
}
