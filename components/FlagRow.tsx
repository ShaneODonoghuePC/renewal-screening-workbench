export function yn(value: boolean) {
  return value ? 'Y' : 'N'
}

export type FlagSeverity = 'critical' | 'warning'

// Text color per severity, chosen for contrast against that severity's fill --
// white reads fine on red-600 (~4.8:1) but fails on amber-500/600 (~2.4:1), so
// warning rows get dark text instead rather than assuming white works everywhere.
const SEVERITY_FILL: Record<FlagSeverity, string> = {
  critical: 'bg-red-600 text-white',
  warning: 'bg-amber-500 text-slate-900',
}

// Shared by the Risk Assessment panel and Renewal Management's RPUX Auto-Renew
// expand-row (§5.4, §5.6) — same Y/N + synthesized-figure presentation whether a flag
// fired or came back clean. `severity` is only passed for flags that actually count
// toward a grade (see FlagDetailPanel); informational-only rows (currently just Is
// Frame) omit it entirely -- they're deliberately not flags, so even when fired they
// stay plain/muted rather than red, so they read as "not a flag" instead of a
// broken-looking real one.
export default function FlagRow({
  label,
  fired,
  figure,
  severity,
}: {
  label: string
  fired: boolean
  figure?: string | null
  severity?: FlagSeverity
}) {
  const filled = fired && severity != null

  return (
    <div
      className={`-mx-4 flex items-center justify-between rounded border-b px-4 py-2 text-sm last:border-0 ${
        // White border on filled rows (rather than transparent) so two adjacent
        // triggered flags don't blend into one solid block -- a thin visible seam
        // between them instead.
        filled ? `${SEVERITY_FILL[severity]} border-white` : 'border-slate-100'
      }`}
    >
      <span className={filled ? 'font-medium' : 'text-slate-700'}>{label}</span>
      <span className={filled ? 'font-semibold' : 'font-medium text-slate-500'}>
        {yn(fired)}
        {figure != null && figure !== '' ? ` (${figure})` : ''}
      </span>
    </div>
  )
}
