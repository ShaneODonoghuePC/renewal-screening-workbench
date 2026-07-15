import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { db } from './db/client'
import { users, policies } from './db/schema'
import { eq } from 'drizzle-orm/sql'

export type SessionPayload = {
  userId: string
  country: string
}

const cookieName = 'acting_as'
const secret = process.env.SESSION_SECRET || 'default-session-secret'
const maxAge = 7 * 24 * 60 * 60

function sign(payload: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

function encodeSession(payload: SessionPayload) {
  const raw = JSON.stringify(payload)
  const encoded = Buffer.from(raw, 'utf8').toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

function decodeSession(value: string): SessionPayload | null {
  const [encoded, signature] = value.split('.')
  if (!encoded || !signature) return null
  if (sign(encoded) !== signature) return null

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    if (typeof parsed?.userId === 'string' && typeof parsed?.country === 'string') {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

function parseCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(';').map((part) => part.trim())
  for (const part of parts) {
    if (part.startsWith(`${cookieName}=`)) {
      return part.slice(cookieName.length + 1)
    }
  }
  return null
}

export function getSession(request: Request): SessionPayload | null {
  const cookieHeader = request.headers.get('cookie')
  const cookieValue = parseCookieHeader(cookieHeader)
  if (!cookieValue) return null
  return decodeSession(cookieValue)
}

export function requireSession(request: Request) {
  const session = getSession(request)
  if (!session) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return session
}

export async function createSession(request: Request) {
  const body = await request.json()
  const userId = String(body.userId || '')
  const user = await db.select().from(users).where(eq(users.id, userId))
  if (user.length === 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const payload: SessionPayload = {
    userId: user[0].id,
    country: user[0].country,
  }
  const value = encodeSession(payload)
  const response = NextResponse.json(payload)
  response.cookies.set({
    name: cookieName,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
  return response
}

export async function requirePolicyCountry(request: Request, policyId: string) {
  const session = requireSession(request)
  const data = await db.select({ country: policies.country }).from(policies).where(eq(policies.id, policyId))
  if (data.length === 0) {
    throw NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (data[0].country !== session.country) {
    throw NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return session
}

export function requireSameCountry(session: SessionPayload, country: string) {
  if (session.country !== country) {
    throw NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return session
}

// requireSession/requirePolicyCountry throw a NextResponse for the 401/403/404 cases above,
// but a thrown Response isn't caught by Next's route handling — it surfaces as a generic 500,
// not the intended status. These wrappers catch that thrown Response and actually return it.
async function unwrapSessionGuard(
  guard: () => SessionPayload | Promise<SessionPayload>,
  handler: (session: SessionPayload) => Promise<Response> | Response
): Promise<Response> {
  try {
    const session = await guard()
    return await handler(session)
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}

export function withSession(
  request: Request,
  handler: (session: SessionPayload) => Promise<Response> | Response
): Promise<Response> {
  return unwrapSessionGuard(() => requireSession(request), handler)
}

export function withPolicyCountry(
  request: Request,
  policyId: string,
  handler: (session: SessionPayload) => Promise<Response> | Response
): Promise<Response> {
  return unwrapSessionGuard(() => requirePolicyCountry(request, policyId), handler)
}
