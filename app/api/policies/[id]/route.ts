import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { policies } from '@/lib/db/schema'
import { withPolicyCountry } from '@/lib/session'
import { eq } from 'drizzle-orm/sql'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  return withPolicyCountry(request, params.id, async () => {
    const data = await db.select().from(policies).where(eq(policies.id, params.id))
    if (data.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(data[0])
  })
}
