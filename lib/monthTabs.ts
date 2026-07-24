import { deriveRenewalMonth } from './renewalMonth'

export type MonthTab = { value: string; label: string; count: number }

type MonthTabItem = { renewalDate: string | null | undefined }

const MONTH_NAMES = [
  '',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Builds Renewal Month tabs from whichever items are passed in. Terminal/closed items
// used to be excluded here unconditionally, back when the caller's tables never showed
// them regardless of any filter -- now that Status (including a Closed bucket) is a
// user-controlled filter on the unified Renewal Management list, that decision belongs
// to the caller: pass in whatever's already been filtered by Routing + Status, and the
// tab counts reflect exactly that.
export function buildMonthTabs(items: MonthTabItem[]): { tabs: MonthTab[] } {
  const counts = new Map<string, number>()

  for (const item of items) {
    const derived = deriveRenewalMonth(item.renewalDate)
    if (!derived) continue
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

  return { tabs }
}
