import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

const url = process.env.TURSO_DATABASE_URL ?? 'file:./local.db'
const libsqlClient = createClient({ url })
const db = drizzle(libsqlClient)

export { libsqlClient, db }
export default db
