// Two-tier severity coding (§3.2): the scoring model only ever produces High or Medium
// attention — there is no third "good/clear" tier, so this is deliberately not a
// red/amber/green scheme. High and Medium each get one brand colour; rows with nothing
// to flag (Auto-Renew, Navins Renew) get plain neutral grey, not a "green" success colour.
export default function SeverityBadge({ attention }: { attention: string | null | undefined }) {
  if (attention === 'High') {
    return (
      <span className="inline-flex rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-white">
        High
      </span>
    )
  }
  if (attention === 'Medium') {
    return (
      <span className="inline-flex rounded-full bg-sage px-2.5 py-0.5 text-xs font-semibold text-brand">
        Medium
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
      {attention || 'None'}
    </span>
  )
}
