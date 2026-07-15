'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: 'Team View' },
  { href: '/review/auto-renew', label: 'Auto-Renew Log' },
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
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              active
                ? 'border-[#122933] bg-[#122933] text-white'
                : 'border-[#122933] text-[#122933] hover:bg-[#122933]/5'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
