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
  consolidatedAccounts: boolean
  latestConsolidatedProfitNegative: boolean
  consolidatedAssetsMovedSignificant: boolean
  dnbRating: string | null
  latestNetIncome: number | null
  assetsChangePercent: number | null
  dnbOperatingStatusLabel: string | null
  dnbListedExchange: string | null
}

// Shared inline flag breakdown, used by RiskQualityPanel's Risk Assessment view and by
// Renewal Management's RPUX Auto-Renew expand-row detail (§5.3, §5.6) — same fields,
// same layout.
export default function FlagDetailPanel({
  item,
  stage1Heading = 'Operational Review Flags',
  stage2Heading = 'Company & Financial Flags',
}: {
  item: FlagEvidence
  stage1Heading?: string
  stage2Heading?: string
}) {
  // Already side by side at md+ (grid-cols-2) -- Operational has 5 rows, Company &
  // Financial has 6, so their content naturally differs in height. Grid's default
  // align-items:stretch already stretches each OUTER grid item (the flex-col wrapper
  // below) to match the taller row, but that alone doesn't make the bordered box
  // inside fill it -- flex-1 on the box is what actually consumes that stretched
  // height (2026-09-10), so the two boxes read as visually equal rather than the
  // shorter one trailing off with blank space beside a taller neighbour. Deliberately
  // not a hardcoded height: this scales with whichever side has more rows in future.
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">{stage1Heading}</h3>
        <div className="flex-1 rounded-md border border-slate-200 bg-white p-4">
          <FlagRow label="Open Claim" fired={item.openClaim} severity="critical" />
          <FlagRow label="Premium Unpaid" fired={item.premiumUnpaid} severity="critical" />
          <FlagRow label="Renewal Type Manual" fired={item.renewalTypeManual} severity="warning" />
          <FlagRow label="System Listed Company" fired={item.systemListedCompany} severity="warning" />
          <FlagRow label="Is Frame" fired={item.isFrame} />
        </div>
      </div>
      <div className="flex flex-col">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">{stage2Heading}</h3>
        <div className="flex-1 rounded-md border border-slate-200 bg-white p-4">
          <FlagRow label="D&B No Match" fired={item.dnbNoMatch} severity="warning" />
          <FlagRow
            label="D&B Status Inactive"
            fired={item.dnbStatusInactive}
            figure={item.dnbOperatingStatusLabel}
            severity="warning"
            unavailable={item.dnbNoMatch}
          />
          <FlagRow
            label="D&B Rating Below A"
            fired={item.dnbRatingBelowA}
            figure={item.dnbRating}
            severity="warning"
            unavailable={item.dnbNoMatch}
          />
          <FlagRow
            label="Latest Profit Negative"
            fired={item.latestProfitNegative}
            figure={formatCurrency(item.latestNetIncome, item.currency)}
            severity="warning"
            unavailable={item.dnbNoMatch}
          />
          <FlagRow
            label="Assets Moved >25% YoY"
            fired={item.assetsMovedSignificant}
            figure={
              item.assetsChangePercent != null
                ? `${item.assetsChangePercent > 0 ? '+' : ''}${item.assetsChangePercent}%`
                : undefined
            }
            severity="warning"
            unavailable={item.dnbNoMatch}
          />
          <FlagRow
            label="D&B Listed Company"
            fired={item.dnbListedCompany}
            figure={item.dnbListedExchange}
            severity="warning"
            unavailable={item.dnbNoMatch}
          />
          {/* Consolidated-accounts trio (2026-09-11, SPEC.md S3.3), appended after D&B
              Listed Company. Consolidated Accounts is rendered WITHOUT severity, the
              same plain/muted treatment as Is Frame above -- it's pure context, not a
              scoring flag, and must not read as one (this app has shipped that mistake
              three times already: Is Frame, D&B Listed Company, D&B Status Inactive).
              The other two DO score, so they get severity="warning" like their peers.
              None of the three use `unavailable` -- that's specifically the No Match
              invariant's rendering (dnbNoMatch), a different, unrelated gate; the
              consolidated invariant's own simplification (the two dependent flags read
              as a plain "N" when Consolidated Accounts is false) is deliberate, not a
              gap -- see SPEC.md S3.3. */}
          <FlagRow label="Consolidated Accounts" fired={item.consolidatedAccounts} />
          <FlagRow label="Latest Consolidated Profit Negative" fired={item.latestConsolidatedProfitNegative} severity="warning" />
          <FlagRow label="Consolidated Assets Moved >25% YoY" fired={item.consolidatedAssetsMovedSignificant} severity="warning" />
        </div>
      </div>
    </div>
  )
}
