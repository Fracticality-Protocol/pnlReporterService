import {
  FractalityPnlReporter,
  NavDataFromApi,
  MainServiceJobResults,
  MainServiceJobResultsCode,
  NavDataFromApiScaled
} from './../src/pnlReporter'

import {
  getPnlReporterData,
  PnlReporterData,
  deletePnlReporterData,
  updatePnlReporterData
} from '../src/database'
import FractalityV2VaultABI from '../contracts/FractalityV2Vault.json'
import { KeyMode, OperationMode } from '../src/modes'
import { env } from '../src/env'

function createNewNavData(
  previousPnlReporterData: NavDataFromApiScaled,
  desiredPercentageChange: number,
  desiredTimeDeltaSecs: number
): NavDataFromApiScaled {
  if (!previousPnlReporterData.timestamp) {
    throw new Error(
      'Failure - the previousProcessedNavTimeStamp is not set, should have been set at initialization'
    )
  }
  if (!previousPnlReporterData.nav) {
    throw new Error(
      'Failure - the previousProcessedNav is not set, should have been set at initialization'
    )
  }
  const newNavTimeStamp: number = previousPnlReporterData.timestamp + desiredTimeDeltaSecs

  // Convert percentage to a factor (e.g., 0.25% becomes 1.0025)
  const factor = BigInt(Math.round((1 + desiredPercentageChange / 100) * 1e6))

  // Calculate new NAV
  const newNav = (previousPnlReporterData.nav * factor) / BigInt(1e6)

  return {
    nav: newNav,
    timestamp: newNavTimeStamp
  } as NavDataFromApiScaled
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

//NOTE: NON KMS, which is impossible to test locally.
describe('FractalityPnlReporter - NON KMS', () => {
  let pnlReporter: FractalityPnlReporter

  beforeAll(async () => {
    process.env.TIME_PERIOD_FOR_CONTRACT_WRITE = '10' //10 seconds
  })

  beforeEach(async () => {
    //push mode, only the initial nav is pulled from the API the rest needs to be pushed.
    pnlReporter = new FractalityPnlReporter(
      env,
      FractalityV2VaultABI.abi,
      OperationMode.PUSH,
      KeyMode.PRIVATE_KEY
    )
    await deletePnlReporterData()
  })

  test('No percentage change at all', async () => {
    await pnlReporter.initialize()

    const vaultAssets = await pnlReporter.blockchainConnection?.contract.vaultAssets()
    console.log('vaultAssets', vaultAssets)

    //get the same value as the vaultAssets, no percentage change
    const initialNavData: NavDataFromApi = {
      nav: vaultAssets,
      timestamp: Math.floor(new Date().getTime() / 1000)
    }

    const results = await pnlReporter.mainService(initialNavData)

    if (!results) throw new Error('Results should not be null')

    expect(results).toBeTruthy()
    expect(results.delta).toBe(BigInt(0))
    expect(results.percentageChange).toBe(0)
    expect(results.txResults).toBeNull()
    expect(results.code).toBe(MainServiceJobResultsCode.DELTA_ZERO_NO_WRITE)

    expect(results.profitEntry).toBeNull()

    const postData = await getPnlReporterData()
    expect(postData?.id).toEqual('singleton')
    expect(postData?.previousContractWriteTimeStamp).toEqual(0)
    expect(postData?.previousProcessedNav).toEqual(initialNavData.nav.toString())
    expect(postData?.previousProcessedNavTimeStamp).toEqual(initialNavData.timestamp)
  })

  test('percentage change (positive) triggers a write to the contract', async () => {
    const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
    await updatePnlReporterData(Math.floor(Date.now() / 1000), '0', 0) //fake that there just was a write
    await percentageChangeTriggerTest(minPercentageChange)
  })

  test('percentage change (negative) triggers a write to the contract', async () => {
    const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
    await percentageChangeTriggerTest(-minPercentageChange)
  })

  test('time threshhold change triggers a write to the contract (positive)', async () => {
    const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
    const prevNavData = await percentageChangeTriggerTest(minPercentageChange)

    const minTimePeriodForContractWrite = parseFloat(
      process.env.TIME_PERIOD_FOR_CONTRACT_WRITE as string
    )

    //this is the first initial write, 1 seconds after the initialization, due to the min percentage being breached
    const newNavData = createNewNavData(
      prevNavData,
      minPercentageChange - 0.1, //not enoguh to trigger the percentage change
      minTimePeriodForContractWrite
    )

    console.log('sleeping for ', minTimePeriodForContractWrite, ' seconds to match blockchain time')
    await sleep(minTimePeriodForContractWrite)

    const results = await pnlReporter.mainService(newNavData)
    console.log('results: ', results)

    const delta = newNavData.nav - prevNavData.nav
    expect(results).toBeTruthy()
    expect(results.delta).toBe(delta)
    expect(results.percentageChange as number).toBe(minPercentageChange - 0.1)
    expect(results.txResults).toBeTruthy()
    expect(results.code).toBe(
      MainServiceJobResultsCode.TIME_SINCE_LAST_CONTRACT_WRITE_THRESHOLD_REACHED_WRITE
    )

    const postData = await getPnlReporterData()
    expect(postData?.id).toEqual('singleton')
    expect(postData?.previousContractWriteTimeStamp).toEqual(results.txResults?.txTimestamp)
    expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
    expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)

    const performanceFeeDecimal = (pnlReporter.PERFORMANCE_FEE_PERCENTAGE / 100) as number
    const profitPerformanceFee = BigInt(Math.floor(Number(delta) * performanceFeeDecimal))
    const profitInvestors = delta - profitPerformanceFee

    expect(results.profitEntry).toBeTruthy()
    expect(results.profitEntry?.profitTotal).toBe(delta)
    expect(results.profitEntry?.profitInvestors).toBe(profitInvestors)
    expect(results.profitEntry?.profitPerformanceFee).toBe(profitPerformanceFee)
  })

  test('time threshhold change triggers a write to the contract (negative)', async () => {
    const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
    const prevNavData = await percentageChangeTriggerTest(minPercentageChange)

    const minTimePeriodForContractWrite = parseFloat(
      process.env.TIME_PERIOD_FOR_CONTRACT_WRITE as string
    )

    const newNavData = createNewNavData(
      prevNavData,
      0.1 - minPercentageChange,
      minTimePeriodForContractWrite
    )

    console.log('sleeping for ', minTimePeriodForContractWrite, ' seconds to match blockchain time')
    await sleep(minTimePeriodForContractWrite)

    const results = await pnlReporter.mainService(newNavData)
    console.log('results: ', results)

    const delta = newNavData.nav - prevNavData.nav

    expect(results).toBeTruthy()
    expect(results.delta).toBe(BigInt(delta))
    expect(results.percentageChange as number).toBe(0.1 - minPercentageChange)
    expect(results.txResults).toBeTruthy()
    expect(results.code).toBe(
      MainServiceJobResultsCode.TIME_SINCE_LAST_CONTRACT_WRITE_THRESHOLD_REACHED_WRITE
    )

    const postData = await getPnlReporterData()
    expect(postData?.id).toEqual('singleton')
    expect(postData?.previousContractWriteTimeStamp).toEqual(results.txResults?.txTimestamp)
    expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
    expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)

    const performanceFeeDecimal = (pnlReporter.PERFORMANCE_FEE_PERCENTAGE / 100) as number
    const profitPerformanceFee = BigInt(Math.floor(Number(delta) * performanceFeeDecimal))
    const profitInvestors = delta - profitPerformanceFee

    expect(results.profitEntry).toBeTruthy()
    expect(results.profitEntry?.profitTotal).toBe(delta)
    expect(results.profitEntry?.profitInvestors).toBe(profitInvestors)
    expect(results.profitEntry?.profitPerformanceFee).toBe(profitPerformanceFee)
  })

  test('time threshhold and percenrage change are not breached, no write to the contract', async () => {
    const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)

    const prevNavData = await percentageChangeTriggerTest(minPercentageChange)

    const timeDeltaSecs = 1

    const newNavData = createNewNavData(prevNavData, minPercentageChange - 0.1, timeDeltaSecs) //neither percentage change nor time threshold are breached

    console.log('sleeping for ', timeDeltaSecs, ' seconds to match blockchain time')
    await sleep(timeDeltaSecs)

    const preData = await getPnlReporterData()

    const results = await pnlReporter.mainService(newNavData)
    console.log('results: ', results)

    expect(results).toBeTruthy()
    expect(results.delta).toBe(newNavData.nav - prevNavData.nav)

    expect(results.percentageChange as number).toBe(minPercentageChange - 0.1)
    expect(results.txResults).toBeNull()
    expect(results.code).toBe(MainServiceJobResultsCode.NO_TRIGGER_NO_WRITE)
    expect(results.profitEntry).toBeNull()

    const postData = await getPnlReporterData()
    expect(postData?.id).toEqual(preData?.id)
    expect(postData?.previousContractWriteTimeStamp).toEqual(
      preData?.previousContractWriteTimeStamp
    )
    expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
    expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)
  })

  async function percentageChangeTriggerTest(percentageChange: number) {
    await pnlReporter.initialize()
    const vaultAssets: bigint = await pnlReporter.blockchainConnection?.contract.vaultAssets()
    console.log('vaultAssets', vaultAssets)

    const initialNavData: NavDataFromApiScaled = {
      nav: vaultAssets,
      timestamp: Math.floor(new Date().getTime() / 1000)
    }

    console.log('percentageChange', percentageChange)
    //this is the first initial write, 1 seconds after the initialization, due to the min percentage being breached
    const newNavData = createNewNavData(initialNavData, percentageChange, 1)

    console.log('newNavData', newNavData)

    const results = await pnlReporter.mainService(newNavData)

    const delta = newNavData.nav - vaultAssets

    expect(results).toBeTruthy()
    expect(results.delta).toBe(delta)
    expect(results.percentageChange as number).toBe(percentageChange)
    expect(results.txResults).toBeTruthy()
    expect(results.code).toBe(MainServiceJobResultsCode.PERCENTAGE_CHANGE_THRESHOLD_REACHED)

    const postData = await getPnlReporterData()
    expect(postData?.id).toEqual('singleton')
    expect(postData?.previousContractWriteTimeStamp).toEqual(results.txResults?.txTimestamp)
    expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
    expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)

    const performanceFeeDecimal = (pnlReporter.PERFORMANCE_FEE_PERCENTAGE / 100) as number
    const profitPerformanceFee = BigInt(Math.floor(Number(delta) * performanceFeeDecimal))
    const profitInvestors = delta - profitPerformanceFee

    expect(results.profitEntry).toBeTruthy()
    expect(results.profitEntry?.profitTotal).toBe(delta)
    expect(results.profitEntry?.profitInvestors).toBe(profitInvestors)
    expect(results.profitEntry?.profitPerformanceFee).toBe(profitPerformanceFee)

    return newNavData
  }
})
