import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'
import { env } from '../env'

let db: PostgresJsDatabase<typeof schema> | null = null

export async function initializeDatabaseConnection(): Promise<PostgresJsDatabase<typeof schema>> {
  const connection = postgres({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: 'prefer'
  })
  db = drizzle(connection, { schema })
  console.log('database connection initialized')
  return db
}

export type PnlReporterData = typeof schema.pnlReporterData.$inferSelect

export const updatePnlReporterData = async (
  previousContractWriteTimeStamp: number,
  previousProcessedNav: number,
  previousProcessedNavTimeStamp: number
) => {
  if (!db) {
    throw new Error('Database not initialized')
  }

  await db
    .insert(schema.pnlReporterData)
    .values({
      id: 'singleton',
      previousContractWriteTimeStamp: previousContractWriteTimeStamp,
      previousProcessedNav: previousProcessedNav.toString(),
      previousProcessedNavTimeStamp: previousProcessedNavTimeStamp
    })
    .onConflictDoUpdate({
      target: schema.pnlReporterData.id,
      set: {
        previousContractWriteTimeStamp: previousContractWriteTimeStamp,
        previousProcessedNav: previousProcessedNav.toString(),
        previousProcessedNavTimeStamp: previousProcessedNavTimeStamp
      }
    })
}

export const getPnlReporterData = async () => {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return await db.query.pnlReporterData.findFirst()
}
