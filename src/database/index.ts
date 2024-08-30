import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'

import * as schema from './schema'

let db: PostgresJsDatabase<typeof schema> | null = null

export async function initializeDatabaseConnection(): Promise<PostgresJsDatabase<typeof schema>> {
  if (db) {
    return db
  }
  let connection: postgres.Sql<{}> | null = null
  if (process.env.UNIT_TEST_MODE) {
    //local defaults for a local db instance
    connection = postgres({
      database: process.env.DB_NAME
    })
  } else {
    connection = postgres({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: 'prefer'
    })
  }
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
    db = await initializeDatabaseConnection()
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

export const deletePnlReporterData = async () => {
  if (!db) {
    const db = await initializeDatabaseConnection()
    if (!db) {
      throw new Error('Database not initialized')
    } else {
      await db.delete(schema.pnlReporterData).where(eq(schema.pnlReporterData.id, 'singleton'))
    }
  }
}

export const getPnlReporterData = async () => {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return await db.query.pnlReporterData.findFirst()
}
