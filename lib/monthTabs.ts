import { deriveRenewalMonth } from './renewalMonth'

export type MonthTab = { value: string; label: string; count: number }

type MonthTabItem = { renewalDate: string | null | undefined; status: string | null }

const MONTH_NAMES = [
  '',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Terminal statuses across both workflows (§6): Manual Review ends at Closed,
// Navins Renew ends at Done. "Outstanding" means neither.
const TERMINAL_STATUSES = new Set(['Closed', 'Done'])

// Shared by Team View, Navins Renew Queue, and the Auto-Renew Log (§5.2): tabs are
// derived from whichever Renewal Month values are present, not the raw renewalDate month.
export function buildMonthTabs(items: MonthTabItem[]): { tabs: MonthTab[]; defaultMonth: string } {
  const counts = new Map<string, number>()

  // Closed (Manual Review) / Done (Navins Renew) items never appear in Team View's
  // tables (§5.3), so they're excluded here too -- the same way app/page.tsx's
  // manualReviewItems/navinsItems already exclude them. Auto-Renew Log passes a
  // placeholder status that never matches TERMINAL_STATUSES, so this is a no-op there.
  for (const item of items) {
    const derived = deriveRenewalMonth(item.renewalDate)
    if (!derived) continue
    if (TERMINAL_STATUSES.has(item.status ?? '')) continue
    const key = `${derived.year}-${String(derived.month).padStart(2, '0')}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const sortedKeys = [...counts.keys()].sort()
  const tabs: MonthTab[] = sortedKeys.map((key) => {
    const [year, month] = key.split('-').map(Number)
    const count = counts.get(key) ?? 0
    return { value: key, label: `${MONTH_NAMES[month]} ${year} (${count})`, count }
  })

  const totalCount = [...counts.values()].reduce((sum, c) => sum + c, 0)
  tabs.push({ value: 'all', label: `All (${totalCount})`, count: totalCount })

  // Every remaining key already has at least one non-terminal item by construction,
  // so the earliest one is the sensible default (same outcome as the old
  // hasOutstanding scan, just simplified now that terminal-only months are excluded).
  const defaultMonth = sortedKeys[0] ?? 'all'

  return { tabs, defaultMonth }
}
