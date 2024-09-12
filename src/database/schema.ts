import { integer, text, pgSchema, uuid, bigint, boolean } from 'drizzle-orm/pg-core'
import { env } from '../env'

export const schema = pgSchema(env.DB_SCHEMA || 'test')

export const pnlReporterData = schema.table('pnl_reporter_data', {
  id: text('id').primaryKey().default('singleton'),
  previousContractWriteTimeStamp: integer('previous_contract_write_timestamp'),
  previousProcessedNav: text('previous_processed_nav'),
  previousProcessedNavTimeStamp: integer('previous_processed_nav_timestamp')
})

export const profitEntries = schema.table('profit_entries', {
  id: uuid('id').primaryKey().notNull(),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  profitTotal: text('profit_total').notNull(),
  profitInvestors: text('profit_investors').notNull(),
  profitPerformanceFee: text('profit_performance_fee').notNull(),
  performanceFeeWithdrawn: boolean('performance_fee_withdrawn').notNull().default(false)
})
