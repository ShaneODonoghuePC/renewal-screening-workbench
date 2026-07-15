import { db } from '@/lib/db/client'
import { users, policies, reviewStates } from '@/lib/db/schema'
import { and, eq, not, sql } from 'drizzle-orm/sql'

async function main() {
  const counts = await db
    .select({
      userId: reviewStates.assignedUserId,
      country: policies.country,
      count: sql`count(*)`,
    })
    .from(reviewStates)
    .innerJoin(policies, eq(reviewStates.policyId, policies.id))
    .where(
      and(
        eq(policies.routing, 'Manual Review'),
        sql`${reviewStates.assignedUserId} IS NOT NULL`
      )
    )
    .groupBy(reviewStates.assignedUserId, policies.country)
    .orderBy(reviewStates.assignedUserId)

  console.log('assignmentCounts:', JSON.stringify(counts, null, 2))

  const specificUser = 'DK-U01'
  const specificCountRows = await db
    .select({ count: sql`count(*)` })
    .from(reviewStates)
    .innerJoin(policies, eq(reviewStates.policyId, policies.id))
    .where(
      and(
        eq(reviewStates.assignedUserId, specificUser),
        eq(policies.routing, 'Manual Review'),
        eq(policies.country, 'DK')
      )
    )

  console.log(`specificUser=${specificUser} manual review assigned count:`, specificCountRows[0]?.count)

  const dkUsers = await db.select().from(users).where(eq(users.country, 'DK'))
  const assignedUserIds = new Set(counts.filter((row) => row.country === 'DK').map((row) => row.userId))
  const zeroAssigned = dkUsers.filter((user) => !assignedUserIds.has(user.id)).slice(0, 5)
  console.log('dkUsersWithoutManualReviewAssignments (up to 5):', JSON.stringify(zeroAssigned, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
