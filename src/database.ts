import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

console.log(process.env.DB_HOST)

const connection = postgres({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: 'prefer'
})

export const db = drizzle(connection, { schema })

export const updatePnlReporterData = async (previousContractWriteTimeStamp: number, previousProcessedNav: number, previousProcessedNavTimeStamp: number) => {
    await db.insert(schema.pnlReporterData).values({
      id: 'singleton',
      previousContractWriteTimeStamp: previousContractWriteTimeStamp,
      previousProcessedNav: previousProcessedNav.toString(),
      previousProcessedNavTimeStamp: previousProcessedNavTimeStamp,
    }).onConflictDoUpdate({
        target: schema.pnlReporterData.id,
        set: {
            previousContractWriteTimeStamp: previousContractWriteTimeStamp,
            previousProcessedNav: previousProcessedNav.toString(),
            previousProcessedNavTimeStamp: previousProcessedNavTimeStamp
        }
    })
  }


  export const getPnlReporterData = async () => {
    return await db.query.pnlReporterData.findFirst()
  }