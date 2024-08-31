import { type Context, type Handler } from 'aws-lambda'

import FractalityV2VaultABI from '../contracts/FractalityV2Vault.json'
import { FractalityPnlReporter, type MainServiceJobResults } from './pnlReporter'
import { env } from './env'

interface ReportEvent {
  timestamp: number
  nav: string
  DAGSTER_PIPES_CONTEXT: string
  DAGSTER_PIPES_MESSAGES: string
}

const pnlReporter = new FractalityPnlReporter(
  env,
  FractalityV2VaultABI.abi,
  env.OPERATION_MODE,
  env.KEY_MODE
)

export const handler: Handler<ReportEvent, MainServiceJobResults | void> = async (
  event,
  context: Context
): Promise<MainServiceJobResults | void> => {
  try {
    return await pnlReporter.initialize({
      nav: parseFloat(event.nav),
      timestamp: event.timestamp
    })
  } catch (error) {
    console.error('Error initializing PNL Reporter:', error)
    throw error
  }
}
