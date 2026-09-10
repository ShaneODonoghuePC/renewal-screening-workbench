'use client'

export default function SlideOutPanel({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      {/* max-w-4xl (was max-w-3xl, 2026-09-10) -- the Loss Ratio table's four cumulative
          columns needed ~741px and only had ~718px at the old width, forcing a
          horizontal scrollbar at normal desktop widths. 896px content width leaves
          headroom above that. The table's own overflow-x-auto wrapper stays in place
          as a fallback for genuinely narrow viewports -- see RiskQualityPanel.tsx. */}
      <div className="relative flex h-screen w-full max-w-4xl flex-col bg-white shadow-2xl">
        {/* Floating Close button (2026-09-12, replaces the old fixed header bar that
            used to hold an optional title + this button) -- positioned absolute
            against THIS wrapper, not inside the scroll container below, so it stays
            pinned top-right regardless of scroll position. Solid bg-white + shadow so
            it stays legible over whatever content scrolls beneath it.
            z-20: above the panel's own content (no explicit z-index of its own) but
            below the grade-card tooltip popovers (z-30, RiskQualityPanel.tsx's
            GradeCard) -- an open tooltip must never be occluded by this button.
            The content below gets extra top padding (pt-16, see the div below) so the
            three grade cards -- specifically the Historical Performance card in the
            rightmost grid column, whose own "?" tooltip trigger sits top-right of
            its own card -- never occupy the same vertical band as this button at all.
            That's a real layout fix, not a z-index-only workaround: verified by
            scrolling to the top of a real panel and both clicking and Tab-ing to each
            control, in the running app, not just reading the JSX. */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-md hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Close ✕
        </button>
        <div className="flex-1 overflow-y-auto p-6 pt-16">{children}</div>
      </div>
    </div>
  )
}
