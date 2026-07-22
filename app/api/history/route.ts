import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { policies, reviewStates, activityLog } from '@/lib/db/schema'
import { withSession } from '@/lib/session'
import { and, eq, inArray, or } from 'drizzle-orm/sql'

export const dynamic = 'force-dynamic'

// Audit trail for closed-out items: Manual Review policies at a terminal status
// (Renewed/Not Renewed), Navins Renew policies at a terminal status (Quote Declined/
// Renewed/Not Renewed). Read-only, summary only — no drill-in, so this deliberately
// doesn't return the full flag/comment/activity detail the Underwriter Workspace does.
export async function GET(request: Request) {
  return withSession(request, async (session) => {
    const items = await db
      .select({
        id: policies.id,
        customerName: policies.customerName,
        renewalDate: policies.renewalDate,
        routing: policies.routing,
        status: reviewStates.status,
      })
      .from(policies)
      .innerJoin(reviewStates, eq(reviewStates.policyId, policies.id))
      .where(
        and(
          eq(policies.country, session.country),
          or(
            and(eq(policies.routing, 'Manual Review'), inArray(reviewStates.status, ['Renewed', 'Not Renewed'])),
            and(eq(policies.routing, 'NAVINS Renew'), inArray(reviewStates.status, ['Quote Declined', 'Renewed', 'Not Renewed']))
          )
        )
      )

    const ids = items.map((item) => item.id)
    const activityRows = ids.length > 0
      ? await db.select().from(activityLog).where(inArray(activityLog.policyId, ids))
      : []

    // For each policy, find the most recent status_change entry whose "to" matches its
    // current terminal status — that's the moment it actually became Closed/Done.
    const closedAtByPolicy = new Map<string, string>()
    for (const row of activityRows) {
      if (row.eventType !== 'status_change') continue
      let detail: Record<string, unknown> = {}
      try {
        detail = row.detail ? JSON.parse(row.detail) : {}
      } catch {
        continue
      }
      const item = items.find((i) => i.id === row.policyId)
      if (!item || detail.to !== item.status) continue
      const existing = closedAtByPolicy.get(row.policyId)
      if (!existing || row.createdAt > existing) {
        closedAtByPolicy.set(row.policyId, row.createdAt)
      }
    }

    const result = items.map((item) => ({
      ...item,
      closedAt: closedAtByPolicy.get(item.id) ?? null,
    }))

    return NextResponse.json(result)
  })
}
