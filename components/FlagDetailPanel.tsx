import FlagRow from './FlagRow'
import { formatCurrency } from '@/lib/format'

export type FlagEvidence = {
  currency: string | null
  openClaim: boolean
  premiumUnpaid: boolean
  renewalTypeManual: boolean
  systemListedCompany: boolean
  isFrame: boolean
  dnbNoMatch: boolean
  dnbStatusInactive: boolean
  dnbRatingBelowA: boolean
  latestProfitNegative: boolean
  assetsMovedSignificant: boolean
  dnbListedCompany: boolean
  dnbRating: string | null
  latestNetIncome: number | null
  assetsChangePercent: number | null
  dnbOperatingStatusLabel: string | null
  dnbListedExchange: string | null
}

// Shared inline flag breakdown, used by Team View's Manual Review expand-row preview
// and the Auto-Renew Log's expand-row detail (§5.3, §5.6) — same fields, same layout.
export default function FlagDetailPanel({
  item,
  stage1Heading = 'Stage 1 flags',
  stage2Heading = 'Stage 2 flags',
}: {
  item: FlagEvidence
  stage1Heading?: string
  stage2Heading?: string
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">{stage1Heading}</h3>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <FlagRow label="Open Claim" fired={item.openClaim} />
          <FlagRow label="Premium Unpaid" fired={item.premiumUnpaid} />
          <FlagRow label="Renewal Type Manual" fired={item.renewalTypeManual} />
          <FlagRow label="System Listed Company" fired={item.systemListedCompany} />
          <FlagRow label="Is Frame" fired={item.isFrame} />
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">{stage2Heading}</h3>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <FlagRow label="D&B No Match" fired={item.dnbNoMatch} />
          <FlagRow label="D&B Status Inactive" fired={item.dnbStatusInactive} figure={item.dnbOperatingStatusLabel} />
          <FlagRow label="D&B Rating Below A" fired={item.dnbRatingBelowA} figure={item.dnbRating} />
          <FlagRow
            label="Latest Profit Negative"
            fired={item.latestProfitNegative}
            figure={formatCurrency(item.latestNetIncome, item.currency)}
          />
          <FlagRow
            label="Assets Moved >25% YoY"
            fired={item.assetsMovedSignificant}
            figure={
              item.assetsChangePercent != null
                ? `${item.assetsChangePercent > 0 ? '+' : ''}${item.assetsChangePercent}%`
                : undefined
            }
          />
          <FlagRow label="D&B Listed Company" fired={item.dnbListedCompany} figure={item.dnbListedExchange} />
        </div>
      </div>
    </div>
  )
}
