import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { policies, reviewStates } from '@/lib/db/schema'
import { withSession } from '@/lib/session'
import { and, eq, inArray } from 'drizzle-orm/sql'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return withSession(request, async (session) => {
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
      .innerJoin(reviewStates, eq(reviewStates.policyId, policies.id))
      .where(
        and(
          eq(policies.country, session.country),
          inArray(policies.routing, ['Manual Review', 'NAVINS Renew'])
        )
      )

    return NextResponse.json(items)
  })
}
