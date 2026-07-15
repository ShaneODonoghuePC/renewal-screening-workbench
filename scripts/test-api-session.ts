import { db } from '@/lib/db/client'
import { users, policies } from '@/lib/db/schema'
import { eq, not } from 'drizzle-orm/sql'

async function main() {
  const user = await db.select().from(users).where(eq(users.id, 'DK-U01'))
  if (user.length === 0) throw new Error('DK user not found')

  const userCountry = user[0].country
  const foreignPolicy = await db
    .select({ id: policies.id, country: policies.country })
    .from(policies)
    .where(not(eq(policies.country, userCountry)))
    .limit(1)

  if (foreignPolicy.length === 0) {
    throw new Error('No foreign policy found')
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
  console.log('session response status', sessionResponse.status)
  console.log('session response body', sessionData)
  console.log('session cookie', cookie)

  const foreignPolicyResponse = await fetch(`http://localhost:3000/api/policies/${encodeURIComponent(foreignPolicy[0].id)}`, {
    method: 'GET',
    headers: {
      cookie,
    },
  })

  const foreignPolicyData = await foreignPolicyResponse.text()
  console.log('foreign policy request status', foreignPolicyResponse.status)
  console.log('foreign policy request body', foreignPolicyData)
}

main().catch(console.error)
