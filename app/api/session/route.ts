import { NextResponse } from 'next/server'
import { createSession, getSession } from '@/lib/session'

export async function GET(request: Request) {
  const session = getSession(request)
  if (!session) {
    return NextResponse.json({ error: 'No active session' }, { status: 401 })
  }
  return NextResponse.json(session)
}

export async function POST(request: Request) {
  return createSession(request)
}
