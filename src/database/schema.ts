import { integer, text, pgSchema } from 'drizzle-orm/pg-core'
import { env } from '../env'

export const schema = pgSchema(env.DB_SCHEMA || 'test')

export const pnlReporterData = schema.table('pnl_reporter_data', {
  id: text('id').primaryKey().default('singleton'),
  previousContractWriteTimeStamp: integer('previous_contract_write_timestamp'),
  previousProcessedNav: text('previous_processed_nav'),
  previousProcessedNavTimeStamp: integer('previous_processed_nav_timestamp')
})
