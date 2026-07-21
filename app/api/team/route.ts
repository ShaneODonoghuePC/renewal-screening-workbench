import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { policies, reviewStates } from '@/lib/db/schema'
import { withSession } from '@/lib/session'
import { eq } from 'drizzle-orm/sql'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return withSession(request, async (session) => {
    // Left join (not inner): RPUX Auto Renew policies have no review_states row at all
    // (§7.2). Included here alongside Manual Review/Navins Renew so Team View's summary
    // strip can show an accurate auto-renew count for the month without a second fetch —
    // the Manual Review/Navins Renew tables themselves still filter by routing as before.
    const items = await db
      .select({
        id: policies.id,
        customerName: policies.customerName,
        premium: policies.premium,
        attention: policies.attention,
        flagReasons: policies.flagReasons,
        renewalDate: policies.renewalDate,
        routing: policies.routing,
        status: reviewStates.status,
        assignedUserId: reviewStates.assignedUserId,
      })
      .from(policies)
      .leftJoin(reviewStates, eq(reviewStates.policyId, policies.id))
      .where(eq(policies.country, session.country))

    return NextResponse.json(items)
  })
}
