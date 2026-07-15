export function yn(value: boolean) {
  return value ? 'Y' : 'N'
}

// Shared by Manual Review Detail and the Auto-Renew Log (§5.4, §5.6) — same Y/N +
// synthesized-figure presentation whether a flag fired or came back clean.
export default function FlagRow({
  label,
  fired,
  figure,
}: {
  label: string
  fired: boolean
  figure?: string | null
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-700">{label}</span>
      <span className={`font-medium ${fired ? 'text-red-600' : 'text-slate-500'}`}>
        {yn(fired)}
        {figure != null && figure !== '' ? ` (${figure})` : ''}
      </span>
    </div>
  )
}
