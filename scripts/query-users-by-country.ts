import { libsqlClient } from '../lib/db/client.js'

async function main() {
  const res = await libsqlClient.execute('SELECT country, COUNT(*) AS cnt FROM users GROUP BY country')
  console.log(JSON.stringify(res.rows, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
