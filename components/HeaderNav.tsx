'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Down to a single destination now that Manual Review/Navins Renew/RPUX Auto-Renew/
// Closed Items are one unified list at "/" -- clicking it is a deliberate no-op (it's
// already where you are), but it still points at "/" rather than "#" so it shows the
// active-tab underline instead of looking dead.
const NAV_ITEMS = [{ href: '/', label: 'Renewal Management' }]

export default function HeaderNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-6">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`border-b-2 pb-1 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
              active ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-brand'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
