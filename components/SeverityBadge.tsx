// Full RAG (red/amber/green) severity treatment, superseding the earlier two-tier
// navy/sage scheme: High = red, Medium = amber (amber, not orange -- orange sits too
// close to red on the hue wheel to scan quickly; amber is the traffic-light middle
// specifically because it reads as unambiguously distinct from red at a glance).
// Rows with nothing to flag (Auto-Renew, Navins Renew) stay plain neutral grey.
export default function SeverityBadge({ attention }: { attention: string | null | undefined }) {
  if (attention === 'High') {
    return (
      <span className="inline-flex rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white">
        High
      </span>
    )
  }
  if (attention === 'Medium') {
    return (
      <span className="inline-flex rounded-full bg-amber-600 px-2.5 py-0.5 text-xs font-semibold text-white">
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
