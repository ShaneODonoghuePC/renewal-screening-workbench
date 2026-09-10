import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const policies = sqliteTable('policies', {
  id: text('id').primaryKey(),
  country: text('country').notNull(),
  customerName: text('customerName').notNull(),
  customerIdentifier: text('customerIdentifier').notNull(),
  brokerName: text('brokerName').notNull(),
  renewalDate: text('renewalDate'),
  currency: text('currency'),
  premium: real('premium'),
  openClaim: integer('openClaim', { mode: 'boolean' }).notNull().default(false),
  premiumUnpaid: integer('premiumUnpaid', { mode: 'boolean' }).notNull().default(false),
  renewalTypeManual: integer('renewalTypeManual', { mode: 'boolean' }).notNull().default(false),
  systemListedCompany: integer('systemListedCompany', { mode: 'boolean' }).notNull().default(false),
  isFrame: integer('isFrame', { mode: 'boolean' }).notNull().default(false),
  dnbNoMatch: integer('dnbNoMatch', { mode: 'boolean' }).notNull().default(false),
  dnbStatusInactive: integer('dnbStatusInactive', { mode: 'boolean' }).notNull().default(false),
  dnbRatingBelowA: integer('dnbRatingBelowA', { mode: 'boolean' }).notNull().default(false),
  latestProfitNegative: integer('latestProfitNegative', { mode: 'boolean' }).notNull().default(false),
  assetsMovedSignificant: integer('assetsMovedSignificant', { mode: 'boolean' }).notNull().default(false),
  dnbListedCompany: integer('dnbListedCompany', { mode: 'boolean' }).notNull().default(false),
  // Consolidated-accounts trio (2026-09-11, SPEC.md S3.3): consolidatedAccounts is pure
  // context (not scored, not in stage2FlagCount, no Flag Reasons entry -- render like
  // isFrame, not like a Stage 2 flag). The other two DO score, same tier as the other
  // Stage 2 flags. Invariant: the two dependent flags can only be true where
  // consolidatedAccounts is true -- see scripts/lib/dnbRules.ts.
  consolidatedAccounts: integer('consolidatedAccounts', { mode: 'boolean' }).notNull().default(false),
  latestConsolidatedProfitNegative: integer('latestConsolidatedProfitNegative', { mode: 'boolean' }).notNull().default(false),
  consolidatedAssetsMovedSignificant: integer('consolidatedAssetsMovedSignificant', { mode: 'boolean' }).notNull().default(false),
  // Business line (2026-09-11, SPEC.md S3.1): conceptual scaffolding for a routing input
  // that, in production, can force Manual Review on its own regardless of source system
  // or flags (a real DK Property register is 100% Manual Review this way). D&O is the
  // only business line modelled here, and D&O never forces review -- see
  // scripts/lib/businessLine.ts. No UI surfaces this column; it exists so the routing
  // rule reads a real field rather than assuming a single implicit business line.
  businessLine: text('businessLine').notNull().default('D&O'),
  stage1FlagCount: integer('stage1FlagCount').notNull().default(0),
  stage2FlagCount: integer('stage2FlagCount').notNull().default(0),
  routing: text('routing'),
  attention: text('attention'),
  flagReasons: text('flagReasons'),
  dnbRating: text('dnbRating'),
  failureScorePercentile: integer('failureScorePercentile'),
  latestNetIncome: integer('latestNetIncome'),
  assetsChangePercent: integer('assetsChangePercent'),
  dnbOperatingStatusLabel: text('dnbOperatingStatusLabel'),
  dnbListedExchange: text('dnbListedExchange'),
})

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  country: text('country').notNull(),
})

export const reviewStates = sqliteTable('review_states', {
  policyId: text('policyId').primaryKey(),
  status: text('status').notNull(),
  assignedUserId: text('assignedUserId'),
})

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  policyId: text('policyId').notNull(),
  userId: text('userId').notNull(),
  text: text('text').notNull(),
  createdAt: text('createdAt').notNull(),
})

export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  policyId: text('policyId').notNull(),
  eventType: text('eventType').notNull(),
  userId: text('userId'),
  detail: text('detail'),
  createdAt: text('createdAt').notNull(),
})
