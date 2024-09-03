import { FractalityPnlReporter } from './pnlReporter'
import FractalityV2VaultABI from '../contracts/FractalityV2Vault.json'

import { env } from './env'

const pnlReporter = new FractalityPnlReporter(
  env,
  FractalityV2VaultABI.abi,
  env.OPERATION_MODE,
  env.KEY_MODE
)

async function main() {
  await pnlReporter.initialize()
}

main()
