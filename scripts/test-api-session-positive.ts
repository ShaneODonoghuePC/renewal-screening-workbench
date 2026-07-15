import { db } from '@/lib/db/client'
import { users, policies } from '@/lib/db/schema'
import { eq } from 'drizzle-orm/sql'

async function main() {
  const user = await db.select().from(users).where(eq(users.id, 'DK-U01'))
  if (user.length === 0) throw new Error('DK user not found')

  const dkPolicy = await db
    .select({ id: policies.id, country: policies.country })
    .from(policies)
    .where(eq(policies.country, user[0].country))
    .limit(1)

  if (dkPolicy.length === 0) {
    throw new Error('No DK policy found')
  }

  const sessionResponse = await fetch('http://localhost:3000/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'DK-U01' }),
  })

  const rawSetCookie = sessionResponse.headers.get('set-cookie')
  if (!rawSetCookie) {
    throw new Error('No session cookie returned')
  }

  const cookie = rawSetCookie.split(';')[0]
  const sessionData = await sessionResponse.json()
  console.log('session status', sessionResponse.status)
  console.log('session body', sessionData)
  console.log('session cookie', cookie)

  const response = await fetch(`http://localhost:3000/api/policies/${encodeURIComponent(dkPolicy[0].id)}`, {
    headers: { cookie },
  })

  const body = await response.text()
  console.log('policy status', response.status)
  console.log('policy body', body)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
