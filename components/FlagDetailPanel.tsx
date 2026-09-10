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

// Shared inline flag breakdown, used by RiskQualityPanel's Underwriter Renewal
// Workbench view and by Renewal Management's RPUX Auto-Renew expand-row detail
// (§5.3, §5.6) — same fields, same layout. stage1Heading/stage2Heading render as h2s
// (2026-09-15, were h3s), matching Identity & Context/Renewal Financials/Loss Ratio's
// heading scale in RiskQualityPanel, since each of these two boxes is a section header
// in its own right rather than needing a shared label above both (SPEC.md S5.4).
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

  // Every Stage 2 row EXCEPT D&B No Match itself is a D&B-sourced finding -- when D&B
  // returns no match, none of them exist (SPEC.md S3.3's No Match invariant), so all of
  // them render "Unavailable" rather than a false-reading "N". That includes
  // Consolidated Accounts: its only job is explaining why the two dependent flags are
  // unset, and on a No Match row it can't do that either -- there's no "no consolidated
  // accounts" finding when D&B never matched the company to check in the first place.
  //
  // Derived HERE, once, rather than passed to every row as `unavailable={item.dnbNoMatch}`
  // (2026-09-16, fixing a real bug: the consolidated trio was added without this prop,
  // so it silently rendered "N" -- a false "assessed and clean" reading -- on No Match
  // policies; the fifth time a new flag was added without its presentation rule
  // following it). Stage2FlagRow closes over `item.dnbNoMatch` so every row that uses it
  // gets this behaviour by construction -- a future Stage 2 flag inherits it just by
  // using this wrapper instead of FlagRow directly, and the failure mode this bug came
  // from (a new prop that has to be remembered at each call site) is gone. D&B No Match
  // itself is rendered with plain FlagRow below, not this wrapper -- it's the cause, not
  // a casualty, and always reads as a normal fired warning row.
  function Stage2FlagRow(props: Omit<Parameters<typeof FlagRow>[0], 'unavailable'>) {
    return <FlagRow {...props} unavailable={item.dnbNoMatch} />
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">{stage1Heading}</h2>
        <div className="flex-1 rounded-md border border-slate-200 bg-white p-4">
          <FlagRow label="Open Claim" fired={item.openClaim} severity="critical" />
          <FlagRow label="Premium Unpaid" fired={item.premiumUnpaid} severity="critical" />
          <FlagRow label="Renewal Type Manual" fired={item.renewalTypeManual} severity="warning" />
          <FlagRow label="System Listed Company" fired={item.systemListedCompany} severity="warning" />
          <FlagRow label="Is Frame" fired={item.isFrame} />
        </div>
      </div>
      <div className="flex flex-col">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">{stage2Heading}</h2>
        <div className="flex-1 rounded-md border border-slate-200 bg-white p-4">
          <FlagRow label="D&B No Match" fired={item.dnbNoMatch} severity="warning" />
          <Stage2FlagRow
            label="D&B Status Inactive"
            fired={item.dnbStatusInactive}
            figure={item.dnbOperatingStatusLabel}
            severity="warning"
          />
          <Stage2FlagRow
            label="D&B Rating Below A"
            fired={item.dnbRatingBelowA}
            figure={item.dnbRating}
            severity="warning"
          />
          <Stage2FlagRow
            label="Latest Profit Negative"
            fired={item.latestProfitNegative}
            figure={formatCurrency(item.latestNetIncome, item.currency)}
            severity="warning"
          />
          <Stage2FlagRow
            label="Assets Moved >25% YoY"
            fired={item.assetsMovedSignificant}
            figure={
              item.assetsChangePercent != null
                ? `${item.assetsChangePercent > 0 ? '+' : ''}${item.assetsChangePercent}%`
                : undefined
            }
            severity="warning"
          />
          <Stage2FlagRow
            label="D&B Listed Company"
            fired={item.dnbListedCompany}
            figure={item.dnbListedExchange}
            severity="warning"
          />
          {/* Consolidated-accounts trio (2026-09-11, SPEC.md S3.3), appended after D&B
              Listed Company. Consolidated Accounts is rendered WITHOUT severity, the
              same plain/muted treatment as Is Frame above -- it's pure context, not a
              scoring flag, and must not read as one (this app has shipped that mistake
              three times already: Is Frame, D&B Listed Company, D&B Status Inactive).
              The other two DO score, so they get severity="warning" like their peers.
              All three go through Stage2FlagRow (2026-09-16, previously plain FlagRow
              with no `unavailable` at all -- the bug this file's top comment describes):
              a matched policy without consolidated accounts still reads a real "N" here
              (`unavailable` is false when dnbNoMatch is false, regardless of
              consolidatedAccounts) -- that's the consolidated invariant's own
              simplification (SPEC.md S3.3), unrelated to and not affected by this
              fix. */}
          <Stage2FlagRow label="Consolidated Accounts" fired={item.consolidatedAccounts} />
          <Stage2FlagRow label="Latest Consolidated Profit Negative" fired={item.latestConsolidatedProfitNegative} severity="warning" />
          <Stage2FlagRow label="Consolidated Assets Moved >25% YoY" fired={item.consolidatedAssetsMovedSignificant} severity="warning" />
        </div>
      </div>
    </div>
  )
}
