import { libsqlClient } from '../lib/db/client.js'

async function main() {
  const tables = ['policies','users','review_states','comments','activity_log']
  for (const t of tables) {
    const res = await libsqlClient.execute(`SELECT COUNT(*) as cnt FROM ${t}`)
    const rows = res.rows as any[]
    const cnt = rows && rows[0] && (rows[0].cnt ?? rows[0].COUNT) ? (rows[0].cnt ?? rows[0].COUNT) : 0
    console.log(`${t}:`, cnt)
  }
}

main().catch(e=>{ console.error(e); process.exit(1) })
