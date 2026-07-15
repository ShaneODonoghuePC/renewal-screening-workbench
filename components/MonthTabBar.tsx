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
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            selected === tab.value
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
