import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

const url = process.env.TURSO_DATABASE_URL ?? 'file:./local.db'
const authToken = process.env.TURSO_AUTH_TOKEN

const libsqlClient = authToken ? createClient({ url, authToken }) : createClient({ url })
const db = drizzle(libsqlClient)

export { libsqlClient, db }
export default db
