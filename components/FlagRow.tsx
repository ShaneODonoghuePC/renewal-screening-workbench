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
//
// `unavailable` (added 2026-09-10) renders neither Y nor N -- a plain "N" with no
// figure is indistinguishable from "checked, confirmed clean," which is the wrong
// read for the five secondary Stage 2 rows on a D&B No Match policy: D&B never
// returned anything about those, so there is no finding to report as clean. Always
// wins over `fired`/`figure`/`severity` when true, since `fired` is guaranteed false
// on these rows anyway (see the No-Match invariant, SPEC.md S3.3) but the distinct
// rendering is what actually communicates "absent," not the boolean underneath it.
export default function FlagRow({
  label,
  fired,
  figure,
  severity,
  unavailable,
}: {
  label: string
  fired: boolean
  figure?: string | null
  severity?: FlagSeverity
  unavailable?: boolean
}) {
  const filled = !unavailable && fired && severity != null

  return (
    <div
      className={`-mx-4 flex items-center justify-between rounded border-b px-4 py-2 text-sm last:border-0 ${
        // White border on filled rows (rather than transparent) so two adjacent
        // triggered flags don't blend into one solid block -- a thin visible seam
        // between them instead.
        filled ? `${SEVERITY_FILL[severity]} border-white` : 'border-slate-100'
      }`}
    >
      <span className={filled ? 'font-medium' : unavailable ? 'text-slate-400' : 'text-slate-700'}>{label}</span>
      {unavailable ? (
        <span className="font-medium italic text-slate-400">Unavailable</span>
      ) : (
        <span className={filled ? 'font-semibold' : 'font-medium text-slate-500'}>
          {yn(fired)}
          {figure != null && figure !== '' ? ` (${figure})` : ''}
        </span>
      )}
    </div>
  )
}
