const base = 'http://127.0.0.1:3000'

async function signIn(userId: string) {
  const res = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) {
    throw new Error(`Sign-in failed: ${res.status} ${await res.text()}`)
  }
  const cookie = res.headers.get('set-cookie')
  if (!cookie) throw new Error('No set-cookie header')
  return cookie
}

async function getPolicies(cookie: string) {
  const res = await fetch(`${base}/api/policies`, {
    headers: { cookie },
  })
  return { status: res.status, body: await res.text() }
}

async function getPolicyById(cookie: string, id: string) {
  const res = await fetch(`${base}/api/policies/${encodeURIComponent(id)}`, {
    headers: { cookie },
  })
  return { status: res.status, body: await res.text() }
}

async function run() {
  const cookie = await signIn('DK-U01')
  console.log('Cookie:', cookie)
  const allPolicies = await getPolicies(cookie)
  console.log('All policies status:', allPolicies.status)
  console.log('All policies body length:', allPolicies.body.length)

  // attempt cross-country access: use DK session to fetch a FI policy
  const forbidden = await getPolicyById(cookie, 'FI-10.101-10001/25/01')
  console.log('Cross-country policy status:', forbidden.status)
  console.log('Cross-country body:', forbidden.body)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
