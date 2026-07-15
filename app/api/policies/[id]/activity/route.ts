import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { activityLog } from '@/lib/db/schema'
import { withPolicyCountry } from '@/lib/session'
import { asc, eq } from 'drizzle-orm/sql'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  return withPolicyCountry(request, params.id, async () => {
    const data = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.policyId, params.id))
      .orderBy(asc(activityLog.createdAt), asc(activityLog.id))
    return NextResponse.json(data)
  })
}
