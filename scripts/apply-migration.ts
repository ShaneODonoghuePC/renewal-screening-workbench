import fs from 'fs'
import path from 'path'
import { libsqlClient } from '../lib/db/client.js'

async function main() {
  const sqlPath = path.resolve(process.cwd(), 'data', 'seed', 'init.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')
  console.log('Applying migration from', sqlPath)
  try {
    // executeMultiple will run the full SQL containing CREATE TABLE and INSERTs
    await libsqlClient.executeMultiple(sql)
    console.log('Migration applied successfully')
  } catch (e) {
    console.error('Migration failed:', e)
    process.exit(1)
  }
}

main()
