'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: 'Assignment & Management' },
  { href: '/review/auto-renew', label: 'Auto-Renew Log' },
  { href: '/review/history', label: 'Closed Items' },
]

export default function HeaderNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-2">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
              active
                ? 'border-brand bg-brand text-white active:bg-brand-dark'
                : 'border-brand text-brand hover:bg-brand/5 active:bg-brand/10'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
