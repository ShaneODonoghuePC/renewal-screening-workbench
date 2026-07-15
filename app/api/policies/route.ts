import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { policies } from '@/lib/db/schema'
import { withSession } from '@/lib/session'
import { eq } from 'drizzle-orm/sql'

export async function GET(request: Request) {
  return withSession(request, async (session) => {
    const data = await db.select().from(policies).where(eq(policies.country, session.country))
    return NextResponse.json(data)
  })
}
