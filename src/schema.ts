import {
    serial,
    varchar,
    timestamp,
    numeric,
    integer,
    text,
    date,
    uniqueIndex,
    pgSchema,
    index
  } from 'drizzle-orm/pg-core'

export const schema = pgSchema(process.env.DB_SCHEMA || 'test')

export const pnlReporterData = schema.table('pnl_reporter_data', {
    id: text('id').primaryKey().default('singleton'),
    previousContractWriteTimeStamp: integer('previous_contract_write_timestamp'),
    previousProcessedNav: text('previous_processed_nav'),
    previousProcessedNavTimeStamp: integer('previous_processed_nav_timestamp'),
});