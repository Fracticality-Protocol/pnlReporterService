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
  if (process.env.NODE_ENV === 'test') {
    //local defaults for a local db instance
    console.log('connected to local database')
    connection = postgres({
      database: process.env.DB_NAME
    })
  } else {
    console.log('connected to ', process.env.DB_HOST)
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
  previousProcessedNav: string,
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
      previousProcessedNav: previousProcessedNav,
      previousProcessedNavTimeStamp: previousProcessedNavTimeStamp
    })
    .onConflictDoUpdate({
      target: schema.pnlReporterData.id,
      set: {
        previousContractWriteTimeStamp: previousContractWriteTimeStamp,
        previousProcessedNav: previousProcessedNav,
        previousProcessedNavTimeStamp: previousProcessedNavTimeStamp
      }
    })
}

export const deletePnlReporterData = async () => {
  let dbConnection: PostgresJsDatabase<typeof schema>
  if (!db) {
    dbConnection = await initializeDatabaseConnection()
    if (!dbConnection) {
      throw new Error('Database not initialized')
    }
  } else {
    dbConnection = db
  }
  await dbConnection
    .delete(schema.pnlReporterData)
    .where(eq(schema.pnlReporterData.id, 'singleton'))
}

export const getPnlReporterData = async () => {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db.query.pnlReporterData.findFirst()
}
