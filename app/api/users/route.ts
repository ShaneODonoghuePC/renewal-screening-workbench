import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { withSession } from '@/lib/session'
import { eq } from 'drizzle-orm/sql'

export async function GET(request: Request) {
  return withSession(request, async (session) => {
    const data = await db.select().from(users).where(eq(users.country, session.country))
    return NextResponse.json(data)
  })
}
