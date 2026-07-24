// The rpgroup.com-inspired stroke-only outline numeral didn't read well in practice --
// back to the same solid, normal typography as every other number in the app (matches
// e.g. the Historical Performance mini-cards' value style). No card, no border, sits
// directly on the page background.
export default function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  )
}
