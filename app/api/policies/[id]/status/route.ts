import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { reviewStates, activityLog, policies } from '@/lib/db/schema'
import { withPolicyCountry } from '@/lib/session'
import { isValidStatusTransition } from '@/lib/statusWorkflow'
import { eq } from 'drizzle-orm/sql'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  return withPolicyCountry(request, params.id, async () => {
    const data = await db.select().from(reviewStates).where(eq(reviewStates.policyId, params.id))
    if (data.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(data[0])
  })
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withPolicyCountry(request, params.id, async (session) => {
    const body = await request.json()
    const newStatus = body.status
    const newAssignedUserId = body.assignedUserId || null

    const existing = await db.select().from(reviewStates).where(eq(reviewStates.policyId, params.id))
    const previous = existing[0]

    if (previous && previous.status !== newStatus) {
      const policyRows = await db.select({ routing: policies.routing }).from(policies).where(eq(policies.id, params.id))
      const routing = policyRows[0]?.routing
      if (!isValidStatusTransition(routing, previous.status, newStatus)) {
        return NextResponse.json(
          { error: `Illegal status transition: ${previous.status} -> ${newStatus}` },
          { status: 400 }
        )
      }
    }

    const now = new Date().toISOString()

    // Status and assignment are independent controls (§6) — log only the field(s) that actually changed.
    if (previous && previous.status !== newStatus) {
      await db.insert(activityLog).values({
        id: `ACT-${Date.now()}-status`,
        policyId: params.id,
        eventType: 'status_change',
        userId: session.userId,
        detail: JSON.stringify({ from: previous.status, to: newStatus }),
        createdAt: now,
      })
    }
    if (previous && previous.assignedUserId !== newAssignedUserId) {
      await db.insert(activityLog).values({
        id: `ACT-${Date.now()}-assign`,
        policyId: params.id,
        eventType: 'assignment_change',
        userId: session.userId,
        detail: JSON.stringify({ from: previous.assignedUserId, to: newAssignedUserId }),
        createdAt: now,
      })
    }

    await db.delete(reviewStates).where(eq(reviewStates.policyId, params.id))
    await db.insert(reviewStates).values({
      policyId: params.id,
      status: newStatus,
      assignedUserId: newAssignedUserId,
    })
    return NextResponse.json({ policyId: params.id, status: newStatus, assignedUserId: newAssignedUserId }, { status: 201 })
  })
}
