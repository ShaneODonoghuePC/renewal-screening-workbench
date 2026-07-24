import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { policies, reviewStates } from '@/lib/db/schema'
import { withSession } from '@/lib/session'
import { eq } from 'drizzle-orm/sql'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return withSession(request, async (session) => {
    // Left join (not inner): RPUX Auto Renew policies have no review_states row at all
    // (§7.2). Single source of truth for the unified Renewal Management list -- every
    // routing (Manual Review, NAVINS Renew, RPUX Auto Renew) and every status including
    // terminal/closed ones, with the full flag-evidence columns too so Auto-Renew rows'
    // read-only flag-detail expand doesn't need a second fetch against /api/policies.
    const items = await db
      .select({
        id: policies.id,
        country: policies.country,
        customerName: policies.customerName,
        customerIdentifier: policies.customerIdentifier,
        brokerName: policies.brokerName,
        renewalDate: policies.renewalDate,
        currency: policies.currency,
        premium: policies.premium,
        openClaim: policies.openClaim,
        premiumUnpaid: policies.premiumUnpaid,
        renewalTypeManual: policies.renewalTypeManual,
        systemListedCompany: policies.systemListedCompany,
        isFrame: policies.isFrame,
        dnbNoMatch: policies.dnbNoMatch,
        dnbStatusInactive: policies.dnbStatusInactive,
        dnbRatingBelowA: policies.dnbRatingBelowA,
        latestProfitNegative: policies.latestProfitNegative,
        assetsMovedSignificant: policies.assetsMovedSignificant,
        dnbListedCompany: policies.dnbListedCompany,
        stage1FlagCount: policies.stage1FlagCount,
        stage2FlagCount: policies.stage2FlagCount,
        routing: policies.routing,
        attention: policies.attention,
        flagReasons: policies.flagReasons,
        dnbRating: policies.dnbRating,
        failureScorePercentile: policies.failureScorePercentile,
        latestNetIncome: policies.latestNetIncome,
        assetsChangePercent: policies.assetsChangePercent,
        dnbOperatingStatusLabel: policies.dnbOperatingStatusLabel,
        dnbListedExchange: policies.dnbListedExchange,
        status: reviewStates.status,
        assignedUserId: reviewStates.assignedUserId,
      })
      .from(policies)
      .leftJoin(reviewStates, eq(reviewStates.policyId, policies.id))
      .where(eq(policies.country, session.country))

    return NextResponse.json(items)
  })
}
