// Bigger, higher-contrast expand indicator so it reads as an interactive control,
// not decoration (used by the unified Renewal Management list's expand rows).
export default function ExpandCaret({ expanded }: { expanded: boolean }) {
  return (
    <span className="text-2xl font-bold leading-none text-brand" aria-hidden="true">
      {expanded ? '▾' : '▸'}
    </span>
  )
}
