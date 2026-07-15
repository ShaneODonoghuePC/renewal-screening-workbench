import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { asc } from 'drizzle-orm/sql'

// Intentionally unauthenticated: this is the roster the "Acting as" picker itself
// uses to let someone establish a session in the first place, not country-scoped data.
export async function GET() {
  const data = await db.select().from(users).orderBy(asc(users.country), asc(users.name))
  return NextResponse.json(data)
}
