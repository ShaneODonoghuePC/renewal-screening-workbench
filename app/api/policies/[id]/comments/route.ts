import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { comments, activityLog } from '@/lib/db/schema'
import { withPolicyCountry } from '@/lib/session'
import { asc, eq } from 'drizzle-orm/sql'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  return withPolicyCountry(request, params.id, async () => {
    const data = await db
      .select()
      .from(comments)
      .where(eq(comments.policyId, params.id))
      .orderBy(asc(comments.createdAt), asc(comments.id))
    return NextResponse.json(data)
  })
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withPolicyCountry(request, params.id, async (session) => {
    const body = await request.json()
    const now = new Date().toISOString()
    const newComment = {
      id: `CMT-${Date.now()}`,
      policyId: params.id,
      userId: session.userId,
      text: body.text,
      createdAt: now,
    }
    await db.insert(comments).values(newComment)
    await db.insert(activityLog).values({
      id: `ACT-${Date.now()}-comment`,
      policyId: params.id,
      eventType: 'comment_added',
      userId: session.userId,
      detail: JSON.stringify({ text: body.text }),
      createdAt: now,
    })
    return NextResponse.json(newComment, { status: 201 })
  })
}
