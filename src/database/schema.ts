import { integer, text, pgSchema, uuid, boolean, timestamp, numeric } from 'drizzle-orm/pg-core'
import { env } from '../env'

export const schema = pgSchema(env.DB_SCHEMA || 'test')

export const pnlReporterData = schema.table('pnl_reporter_data', {
  id: text('id').primaryKey().default('singleton'),
  previousContractWriteTimeStamp: integer('previous_contract_write_timestamp'),
  previousProcessedNav: text('previous_processed_nav'),
  previousProcessedNavTimeStamp: integer('previous_processed_nav_timestamp'),
  highWaterMark: numeric('high_water_mark')
})

export const profitEntries = schema.table('profit_entries', {
  id: uuid('id').primaryKey().notNull(),
  timestamp: timestamp('timestamp').notNull(),
  profitTotal: numeric('profit_total').notNull(),
  profitInvestors: numeric('profit_investors').notNull(),
  profitPerformanceFee: numeric('profit_performance_fee').notNull(),
  performanceFeeWithdrawn: boolean('performance_fee_withdrawn').notNull().default(false),
  reconciliationTimestamp: timestamp('reconciliation_timestamp')
})
