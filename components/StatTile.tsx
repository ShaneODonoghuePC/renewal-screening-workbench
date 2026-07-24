// rpgroup.com's actual stat treatment (the "19K+ / 25+ / 18 / 325+" strip on
// rpgroup.com): a stroke-only outline numeral -- fill matches the page background,
// -webkit-text-stroke draws the brand-navy outline -- with a small muted label above.
// No card, no border, sits directly on the page background.
export default function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-4xl font-semibold leading-none text-transparent [-webkit-text-stroke:1.5px_#122933]">
        {value}
      </p>
    </div>
  )
}
