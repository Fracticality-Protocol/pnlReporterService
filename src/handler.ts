import { type Context, type Handler } from 'aws-lambda'

import FractalityV2VaultABI from '../contracts/FractalityV2Vault.json'
import { FractalityPnlReporter } from './pnlReporter'
import { env } from './env'

// NOTE: no event required yet
// interface LambdaEvent {}

const pnlReporter = new FractalityPnlReporter(
  env,
  FractalityV2VaultABI.abi,
  env.OPERATION_MODE,
  env.KEY_MODE
)

export const handler: Handler<void, void> = async (event, context: Context): Promise<void> => {
  try {
    await pnlReporter.initialize()
  } catch (error) {
    console.error('Error initializing PNL Reporter:', error)
    throw error
  }
}
