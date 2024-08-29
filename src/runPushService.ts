import { FractalityPnlReporter, KeyMode, OperationMode } from './pnlReporter'
import FractalityV2VaultABI from '../contracts/FractalityV2Vault.json'
import dotenv from 'dotenv'

dotenv.config()

import { env } from './env'

const pnlReporter = new FractalityPnlReporter(
  env,
  FractalityV2VaultABI.abi,
  OperationMode.PUSH,
  KeyMode.KMS
)

async function main() {
  await pnlReporter.initialize()
}

main()
