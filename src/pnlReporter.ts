import { ethers } from 'ethers'
import { AwsKmsSigner } from '@cuonghx.gu-tech/ethers-aws-kms-signer'
import axios from 'axios'
import { type AxiosInstance } from 'axios'
import { CronJob } from 'cron'
import axiosRetry from 'axios-retry'

import { updatePnlReporterData, getPnlReporterData, initializeDatabaseConnection } from './database'
import { type ReporterEnv } from './env'
import { KeyMode, OperationMode } from './modes'

export interface NavDataFromApi {
  nav: number //comes in as a number from api.
  timestamp: number //timestamp (seconds)
}

export interface NavDataFromApiScaled {
  nav: bigint //needs to be in wei units, same as vault.
  timestamp: number //timestamp (seconds)
}

interface BlockchainConnection {
  contract: ethers.Contract
  signer: ethers.Signer | AwsKmsSigner
  provider: ethers.JsonRpcProvider
  assetDecimals: BigInt
}

export interface ProfitEntry {
  profitTotal: bigint
  profitInvestors: bigint
  profitPerformanceFee: bigint
}

export enum MainServiceJobResultsCode {
  DELTA_ZERO_NO_WRITE = 'delta is zero - not writing to contract',
  PERCENTAGE_CHANGE_THRESHOLD_REACHED = 'percentage change threshold reached - writing to contract',
  TIME_SINCE_LAST_CONTRACT_WRITE_THRESHOLD_REACHED_WRITE = 'time since last contract write threshold reached - writing to contract',
  NO_TRIGGER_NO_WRITE = 'delta is not zero, percentage change threshold not reached, and time since last contract write threshold not reached',
  HALTED_NO_WRITE = 'vault halted - not writing to contract'
}

export interface MainServiceJobResults {
  delta: bigint
  percentageChange: number
  txResults: WriteToContractResults | null
  code: string
  profitEntry: ProfitEntry | null
}

export interface WriteToContractResults {
  txTimestamp: number
  hash: string
}

export class FractalityPnlReporter {
  #GET_NAV_URL: string
  #API_KEY: string
  #RPC_URL: string

  VAULT_ADDRESS: string
  TIME_PERIOD_FOR_CONTRACT_WRITE: number //seconds
  PERCENTAGE_TRIGGER_CHANGE: number
  PERFORMANCE_FEE_PERCENTAGE: number
  FRACTALITY_V2_VAULT_ABI: ethers.InterfaceAbi

  #PRIVATE_KEY?: string
  #AWS_KMS_KEY_ID?: string
  #AWS_REGION?: string

  OPERATION_MODE: OperationMode
  KEY_MODE: KeyMode

  blockchainConnection: BlockchainConnection | null
  #client: AxiosInstance | null
  #job: CronJob | null

  constructor(
    _ENV: ReporterEnv,
    _FRACTALITY_V2_VAULT_ABI: ethers.InterfaceAbi,
    _OPERATION_MODE: OperationMode = OperationMode.PULL, // default operation PULL
    _KEY_MODE: KeyMode = KeyMode.PRIVATE_KEY // default authentication PRIVATE_KEY
  ) {
    this.#GET_NAV_URL = _ENV.GET_NAV_URL
    this.#API_KEY = _ENV.API_KEY
    this.#RPC_URL = _ENV.RPC_URL
    this.VAULT_ADDRESS = _ENV.VAULT_ADDRESS
    this.TIME_PERIOD_FOR_CONTRACT_WRITE = _ENV.TIME_PERIOD_FOR_CONTRACT_WRITE
    this.PERCENTAGE_TRIGGER_CHANGE = _ENV.PERCENTAGE_TRIGGER_CHANGE
    this.FRACTALITY_V2_VAULT_ABI = _FRACTALITY_V2_VAULT_ABI
    this.OPERATION_MODE = _OPERATION_MODE
    this.KEY_MODE = _KEY_MODE
    this.PERFORMANCE_FEE_PERCENTAGE = _ENV.PERFORMANCE_FEE_PERCENTAGE
    console.info('Running in ', this.OPERATION_MODE, ' mode')
    console.info('Using ', this.KEY_MODE, ' key management mode')

    this.blockchainConnection = null
    this.#client = null
    this.#job = null

    if (this.KEY_MODE === KeyMode.PRIVATE_KEY) {
      this.#PRIVATE_KEY = _ENV.PRIVATE_KEY
    } else if (this.KEY_MODE === KeyMode.KMS) {
      this.#AWS_KMS_KEY_ID = _ENV.AWS_KMS_KEY_ID
      this.#AWS_REGION = _ENV.AWS_REGION
    } else {
      throw Error(`Invalid KeyMode ${this.KEY_MODE}`)
    }
  }

  //TODO: test this with very large numbers that may overflow the number type.
  _calculatePercentageChange = async (
    newNavData: NavDataFromApiScaled, //in decimals units
    currentVaultAssets: bigint //in full decimals units
  ): Promise<number> => {
    if (!this.blockchainConnection) throw new Error('Blockchain connection not initialized')
    const decimals = await this.blockchainConnection.assetDecimals
    const currentVaultAssetsInDecimals = parseFloat(
      ethers.formatUnits(currentVaultAssets, decimals.valueOf())
    )
    const newNavDataInDecimals = parseFloat(ethers.formatUnits(newNavData.nav, decimals.valueOf()))

    const percentageChange =
      ((newNavDataInDecimals - currentVaultAssetsInDecimals) / currentVaultAssetsInDecimals) * 100
    return Number(percentageChange.toFixed(2))
  }

  _calculateDelta = (newNavData: bigint, currentVaultAssets: bigint): bigint => {
    return newNavData - currentVaultAssets
  }

  _writeToContract = async (delta: bigint): Promise<WriteToContractResults> => {
    if (!this.blockchainConnection) throw new Error('Blockchain connection not initialized')
    console.log('writing to contract')
    let tx
    if (delta > BigInt(0)) {
      console.log('delta is positive - reporting profit')
      tx = await this.blockchainConnection.contract.reportProfits(delta, 'pnlReporterService')
    } else if (delta < BigInt(0)) {
      console.log('delta is negative - reporting loss')
      tx = await this.blockchainConnection.contract.reportLosses(
        -delta, //absolute value of delta
        'pnlReporterService'
      )
    }
    const receipt = await tx.wait()

    console.log('tx hash', receipt.hash)
    const block = await this.blockchainConnection.provider.getBlock(receipt.blockNumber)

    return {
      txTimestamp: block?.timestamp as number,
      hash: receipt.hash
    }
  }

  _getVaultAssets = async (): Promise<bigint> => {
    if (!this.blockchainConnection) throw new Error('Blockchain connection not initialized')
    const vaultAssets = await this.blockchainConnection.contract.vaultAssets()
    return vaultAssets
  }

  //This should be compatible with both push and pull modes.
  //BUSINESS LOGIC - logic to write to contract
  //if percentageTriggerChange is reached, in either direction, write detla to contract
  //else, check if previousContractWriteTimeStamp is set.
  //if it's not set, write detla to contract
  //if it is set, check to see if the time difference between now and previousContractWriteTimeStamp is 10 minutes or greater.
  //if it is, write delta to contract
  //write current timestamp to previousContractWriteTimeStamp
  //if it's not, do nothing
  mainService = async (
    newNavData: NavDataFromApi | NavDataFromApiScaled
  ): Promise<MainServiceJobResults> => {
    let code: MainServiceJobResultsCode = MainServiceJobResultsCode.NO_TRIGGER_NO_WRITE
    this._drawLogo()
    console.log('New Nav data: ', newNavData)

    if (!this.blockchainConnection) throw new Error('Blockchain connection not initialized')
    const decimals = this.blockchainConnection.assetDecimals

    let scaledNavData: NavDataFromApiScaled | null = null
    let profitEntry: ProfitEntry | null = null
    if (typeof newNavData.nav === 'number') {
      scaledNavData = {
        nav: ethers.parseUnits(newNavData.nav.toString(), decimals.valueOf()),
        timestamp: newNavData.timestamp
      } as NavDataFromApiScaled
    } else {
      scaledNavData = newNavData as NavDataFromApiScaled //already passed in scaled.
    }
    const pnlReporterData = await getPnlReporterData()
    const vaultAssets = await this._getVaultAssets()
    console.log('current vaultAssets', vaultAssets)
    let txTimestamp = 0

    if (pnlReporterData) {
      txTimestamp = pnlReporterData?.previousContractWriteTimeStamp as number
    }

    //calculate the percentage change and delta
    const percentageChange = await this._calculatePercentageChange(scaledNavData, vaultAssets)
    console.log('percentage change', percentageChange)

    const delta = this._calculateDelta(scaledNavData.nav, vaultAssets)
    console.log('delta', delta)

    let txResults: WriteToContractResults | null = null

    const isHalted = await this.blockchainConnection.contract.halted()
    if (isHalted) {
      code = MainServiceJobResultsCode.HALTED_NO_WRITE
    } else {
      if (delta.toString() === '0') {
        code = MainServiceJobResultsCode.DELTA_ZERO_NO_WRITE
        console.log(code)
      } else {
        let shouldUpdateContract: boolean = false

        if (Math.abs(percentageChange) >= this.PERCENTAGE_TRIGGER_CHANGE) {
          code = MainServiceJobResultsCode.PERCENTAGE_CHANGE_THRESHOLD_REACHED
          shouldUpdateContract = true
        } else {
          const timeSinceLastContractWrite = Math.floor(Date.now() / 1000) - txTimestamp
          console.log('time since last contract write', timeSinceLastContractWrite)
          if (timeSinceLastContractWrite > this.TIME_PERIOD_FOR_CONTRACT_WRITE) {
            code = MainServiceJobResultsCode.TIME_SINCE_LAST_CONTRACT_WRITE_THRESHOLD_REACHED_WRITE
            shouldUpdateContract = true
          }
        }

        if (shouldUpdateContract) {
          console.log('profit entry', profitEntry)
          txResults = await this._writeToContract(delta)
          txTimestamp = txResults.txTimestamp
          console.log(`Trigger to write latency ${newNavData.timestamp - txTimestamp} sec`)
        } else {
          code = MainServiceJobResultsCode.NO_TRIGGER_NO_WRITE
        }
      }
    }
    //update the pnlReporterData with every single time, even if no transaction took place.
    //which scenarios are this this? Not enough time has passed, or percentage change is not reached.
    //Note: the newNavData written here might have truncation, need to update schema to store as bigint
    await updatePnlReporterData(txTimestamp, newNavData.nav.toString(), newNavData.timestamp)
    console.log('finished job')

    const results = {
      delta: delta,
      percentageChange: percentageChange,
      txResults: txResults,
      code: code,
      profitEntry: profitEntry
    } as MainServiceJobResults
    console.log('Main Service results: ', results)
    return results
  }

  async initialize() {
    await initializeDatabaseConnection()
    this.blockchainConnection = await this._initBlockchainConnection(this.KEY_MODE === KeyMode.KMS)
    if (this.OPERATION_MODE === OperationMode.PULL) {
      this._initializePullMode()
    }
  }

  async _initializePullMode() {
    axiosRetry(axios, {
      retries: 5,
      retryDelay: axiosRetry.exponentialDelay,
      onRetry: (retryCount, error) => {
        console.log(`Retrying request (attempt ${retryCount + 1}): ${error.message}`)
      }
    })
    this.#client = axios.create()

    this.#job = new CronJob(
      '* * * * *', // Cron expression: Run every minute
      () => {
        this._jobRunner()
      }, // Function to execute
      null, // onComplete function (null if not needed)
      false, // Start the job right now
      'UTC' // Time zone
    )
    this.#job.start()
    console.info('Job scheduler started - running continious pull service')
  }

  _jobRunner = async (navData?: NavDataFromApi): Promise<MainServiceJobResults> => {
    try {
      const newNavData = navData ? navData : await this._getNavData()
      const results = await this.mainService(newNavData)
      return results
    } catch (error) {
      throw new Error(`Job failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  _getNavData = async (): Promise<NavDataFromApi> => {
    if (!this.#client) throw new Error('Client not initialized')
    try {
      const response = await this.#client.get(this.#GET_NAV_URL, {
        headers: {
          'x-api-key': this.#API_KEY
        }
      })
      return {
        nav: parseFloat(response.data.nav),
        timestamp: response.data.timestamp
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to get nav data: ${error.message}`)
      } else {
        console.error('An unexpected error occurred:', error)
        throw error
      }
    }
  }

  _initBlockchainConnection = async (useKMS: boolean = false): Promise<BlockchainConnection> => {
    let signer: ethers.Wallet | AwsKmsSigner
    let provider: ethers.JsonRpcProvider

    provider = new ethers.JsonRpcProvider(this.#RPC_URL)

    if (!useKMS) {
      signer = new ethers.Wallet(this.#PRIVATE_KEY!, provider)
    } else {
      signer = new AwsKmsSigner({
        keyId: this.#AWS_KMS_KEY_ID!,
        region: this.#AWS_REGION!
      })
      signer = signer.connect(provider)
    }

    const contract = new ethers.Contract(this.VAULT_ADDRESS, this.FRACTALITY_V2_VAULT_ABI, signer)

    console.log('connected to blockchain')

    const assetAddress = await contract.asset()

    const assetContract = new ethers.Contract(
      assetAddress,
      ['function decimals() view returns (uint8)'],
      signer
    )

    const assetDecimals = await assetContract.decimals()

    return { contract, signer, provider, assetDecimals: assetDecimals }
  }

  //Deprecated
  /*
  _performProfitEntry = async (profitTotal: bigint): Promise<ProfitEntry> => {
    const performanceFeePercentageDecimal = this.PERFORMANCE_FEE_PERCENTAGE / 100
    //note: the perfomance fee can truncte to zero if the profit total is too small. Investor would get the full amount if the
    //perfomance fee turns out to be less than 1 wei.
    const profitPerformanceFee = BigInt(
      Math.floor(Number(profitTotal) * performanceFeePercentageDecimal)
    )
    const profitInvestors = profitTotal - profitPerformanceFee

    await insertProfitEntry(profitTotal, profitInvestors, profitPerformanceFee)
    console.log('profit entry performed')
    return {
      profitTotal: profitTotal,
      profitInvestors: profitInvestors,
      profitPerformanceFee: profitPerformanceFee
    }
  }
  */

  _drawLogo = () => {
    console.log(`
            ┌─────────────────────────┐
            │    PNL REPORTER JOB     │
            │                         │
            │         $$$$$           │
            │       $$     $$         │
            │      $   $$$   $        │
            │      $ $ PNL $ $        │
            │      $   $$$   $        │
            │       $$     $$         │
            │         $$$$$           │
            │                         │
            └─────────────────────────┘
            `)
  }
}

export default FractalityPnlReporter
