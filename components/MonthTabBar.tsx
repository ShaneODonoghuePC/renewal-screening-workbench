'use client'

import type { MonthTab } from '@/lib/monthTabs'

export default function MonthTabBar({
  tabs,
  selected,
  onSelect,
}: {
  tabs: MonthTab[]
  selected: string
  onSelect: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onSelect(tab.value)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
            selected === tab.value
              ? 'bg-brand text-white active:bg-brand-dark'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
