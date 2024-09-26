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
  const factor = BigInt(Math.round((1 + desiredPercentageChange / 100) * 1e18))

  // Calculate new NAV
  const newNav = (previousPnlReporterData.nav * factor) / BigInt(1e18)

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
    await updatePnlReporterData(Math.floor(Date.now() / 1000), '0', 0, null) //fake that there just was a write
    await percentageChangeTriggerTest(minPercentageChange)
  })

  test('percentage change (negative) triggers a write to the contract', async () => {
    const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
    await percentageChangeTriggerTest(-minPercentageChange)
  })

  test('time threshhold change triggers a write to the contract (positive)', async () => {
    const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
    const previousTestResultsNavData = await percentageChangeTriggerTest(minPercentageChange)

    const minTimePeriodForContractWrite = parseFloat(
      process.env.TIME_PERIOD_FOR_CONTRACT_WRITE as string
    )

    //this is the first initial write, 1 seconds after the initialization, due to the min percentage being breached
    const newNavData = createNewNavData(
      previousTestResultsNavData,
      minPercentageChange - 0.1, //not enough to trigger the percentage change
      minTimePeriodForContractWrite
    )

    console.log('sleeping for ', minTimePeriodForContractWrite, ' seconds to match blockchain time')
    await sleep(minTimePeriodForContractWrite)

    const newResults = await pnlReporter.mainService(newNavData)
    console.log('results: ', newResults)

    // This needs to account for fees
    const delta = newNavData.nav - previousTestResultsNavData.highWaterMark

    expect(newResults).toBeTruthy()
    expect(newResults.delta).toBe(delta)
    expect(newResults.percentageChange as number).toBe(minPercentageChange - 0.1)
    expect(newResults.txResults).toBeTruthy()
    expect(newResults.code).toBe(
      MainServiceJobResultsCode.TIME_SINCE_LAST_CONTRACT_WRITE_THRESHOLD_REACHED_WRITE
    )

    const postData = await getPnlReporterData()
    expect(postData?.id).toEqual('singleton')
    expect(postData?.previousContractWriteTimeStamp).toEqual(newResults.txResults?.txTimestamp)
    expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
    expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)

    const performanceFeeDecimal = (pnlReporter.PERFORMANCE_FEE_PERCENTAGE / 100) as number
    const profitPerformanceFee = BigInt(Math.floor(Number(delta) * performanceFeeDecimal))
    const profitInvestors = delta - profitPerformanceFee

    expect(newResults.profitEntry).toBeTruthy()
    expect(newResults.profitEntry?.profitTotal).toBe(delta)
    expect(newResults.profitEntry?.profitInvestors).toBe(profitInvestors)
    expect(newResults.profitEntry?.profitPerformanceFee).toBe(profitPerformanceFee)
  })

  test('time threshhold change triggers a write to the contract (negative)', async () => {
    const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
    const previousTestResultsNavData = await percentageChangeTriggerTest(minPercentageChange)

    const minTimePeriodForContractWrite = parseFloat(
      process.env.TIME_PERIOD_FOR_CONTRACT_WRITE as string
    )

    const newNavData = createNewNavData(
      previousTestResultsNavData,
      0.1 - minPercentageChange,
      minTimePeriodForContractWrite
    )

    console.log('sleeping for ', minTimePeriodForContractWrite, ' seconds to match blockchain time')
    await sleep(minTimePeriodForContractWrite)

    const newResults = await pnlReporter.mainService(newNavData)
    console.log('results: ', newResults)

    const delta = newNavData.nav - previousTestResultsNavData.nav

    expect(newResults).toBeTruthy()
    expect(newResults.delta).toBe(BigInt(delta))
    expect(newResults.percentageChange as number).toBe(0.1 - minPercentageChange)
    expect(newResults.txResults).toBeTruthy()
    expect(newResults.code).toBe(
      MainServiceJobResultsCode.TIME_SINCE_LAST_CONTRACT_WRITE_THRESHOLD_REACHED_WRITE
    )

    const postData = await getPnlReporterData()
    expect(postData?.id).toEqual('singleton')
    expect(postData?.previousContractWriteTimeStamp).toEqual(newResults.txResults?.txTimestamp)
    expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
    expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)

    // With HWM no fees are taken
    expect(newResults.profitEntry).toBe(null)
  })

  test('time threshhold and percentage change are not breached, no write to the contract', async () => {
    const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)

    const previousTestResultsNavData = await percentageChangeTriggerTest(minPercentageChange)

    const timeDeltaSecs = 1

    const newNavData = createNewNavData(
      previousTestResultsNavData,
      minPercentageChange - 0.1,
      timeDeltaSecs
    ) //neither percentage change nor time threshold are breached

    console.log('sleeping for ', timeDeltaSecs, ' seconds to match blockchain time')
    await sleep(timeDeltaSecs)

    const preData = await getPnlReporterData()

    const newResults = await pnlReporter.mainService(newNavData)
    console.log('results: ', newResults)

    expect(newResults).toBeTruthy()
    expect(newResults.delta).toBe(newNavData.nav - previousTestResultsNavData.nav)

    expect(newResults.percentageChange as number).toBe(minPercentageChange - 0.1)
    expect(newResults.txResults).toBeNull()
    expect(newResults.code).toBe(MainServiceJobResultsCode.NO_TRIGGER_NO_WRITE)
    expect(newResults.profitEntry).toBeNull()

    const postData = await getPnlReporterData()
    expect(postData?.id).toEqual(preData?.id)
    expect(postData?.previousContractWriteTimeStamp).toEqual(
      preData?.previousContractWriteTimeStamp
    )
    expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
    expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)
  })

  test('HWM logic is correctly applied in profit calculations', async () => {
    await pnlReporter.initialize()

    const minTimePeriodForContractWrite = parseFloat(
      process.env.TIME_PERIOD_FOR_CONTRACT_WRITE as string
    )

    const initialVaultAssets = await pnlReporter.blockchainConnection?.contract.vaultAssets()
    console.log('Initial vaultAssets', initialVaultAssets)

    const initialNavData: NavDataFromApiScaled = {
      nav: initialVaultAssets,
      timestamp: Math.floor(Date.now() / 1000)
    }

    // First Iteration: Simulate profit
    // Everything should be normal here, reportProfit based on delta, take 20% fee of profit over HWM
    const percentageIncrease1 = 5
    const newNavData1 = createNewNavData(initialNavData, percentageIncrease1, 1)

    let results = await pnlReporter.mainService(newNavData1)

    expect(results).toBeTruthy()
    expect(results.delta).toBe(newNavData1.nav - initialNavData.nav)
    expect(results.percentageChange).toBeCloseTo(percentageIncrease1, 2)
    expect(results.txResults).toBeTruthy()
    expect(results.code).toBe(MainServiceJobResultsCode.PERCENTAGE_CHANGE_THRESHOLD_REACHED)

    // HWM should equal initialNavData + delta - performanceFee
    const initialHighWaterMark =
      initialNavData.nav +
      (newNavData1.nav - initialNavData.nav) -
      results.profitEntry?.profitPerformanceFee!

    expect(results.highWaterMark).toBe(initialHighWaterMark)

    // Calculate profitAboveHWM which in the first case will equal the delta
    const profitAboveHWM1 = results.delta
    const performanceFeePercentageDecimal1 =
      parseFloat(process.env.PERFORMANCE_FEE_PERCENTAGE!) / 100
    const profitPerformanceFee1 = BigInt(
      Math.floor(Number(profitAboveHWM1) * performanceFeePercentageDecimal1)
    )
    // const profitInvestors = profitAboveHWM1 - profitPerformanceFee1

    // Once the process is run again the NAV will be equal to the last processed NAV - performance fees
    const expectedNewNav1 = newNavData1.nav - profitPerformanceFee1
    expect(await pnlReporter.blockchainConnection?.contract.vaultAssets()).toBe(expectedNewNav1)

    // Second Iteration: Simulate loss
    // This is where the NAV decreases vaultAssets but does not take fees, but also does not change the HWM
    await sleep(minTimePeriodForContractWrite + 1)

    const percentageDecrease = -3
    const newNavData2 = createNewNavData(
      { nav: expectedNewNav1, timestamp: Math.floor(Date.now() / 1000) },
      percentageDecrease,
      1
    )

    results = await pnlReporter.mainService(newNavData2)

    expect(results).toBeTruthy()
    expect(results.delta).toBe(newNavData2.nav - expectedNewNav1) // Delta will equal to latest nav - (previous nav - previous fees)
    expect(results.percentageChange).toBeCloseTo(percentageDecrease, 2)
    expect(results.txResults).toBeTruthy()
    expect(results.code).toBe(MainServiceJobResultsCode.PERCENTAGE_CHANGE_THRESHOLD_REACHED)
    expect(results.profitEntry).toBe(null) // Not profits saved in loss event
    expect(results.highWaterMark).toBe(initialHighWaterMark) // HWM should remain unchanged

    // The next expected NAV should be the same as there will be no additional offsets made
    const expectedNewNav2 = newNavData2.nav
    expect(await pnlReporter.blockchainConnection?.contract.vaultAssets()).toBe(expectedNewNav2)

    // Third Iteration: Simulate NAV returning to the HWM but not exceeding it
    // We need to reportProfit to contract but take no other actions
    await sleep(minTimePeriodForContractWrite + 1)

    const percentageIncrease2 = 3
    const newNavData3 = createNewNavData(
      { nav: expectedNewNav2, timestamp: Math.floor(Date.now() / 1000) },
      percentageIncrease2,
      1
    )

    results = await pnlReporter.mainService(newNavData3)

    // NOTE: No performance fee should be taken since NAV hasn't exceeded HWM
    expect(results).toBeTruthy()
    expect(results.delta).toBe(newNavData3.nav - expectedNewNav2)
    expect(results.percentageChange).toBeCloseTo(percentageIncrease2, 2)
    expect(results.txResults).toBeTruthy()
    expect(results.code).toBe(MainServiceJobResultsCode.PERCENTAGE_CHANGE_THRESHOLD_REACHED)
    expect(results.profitEntry).toBe(null) // Not profits taken despite the profit up to the HWM

    // The next expected NAV should be the same as there will be no additional offsets made despite the profit
    const expectedNewNav3 = newNavData3.nav
    expect(await pnlReporter.blockchainConnection?.contract.vaultAssets()).toBe(expectedNewNav3)

    // Fourth Iteration: Simulate zero NAV activity to check for feedback loops
    // If vault assets are in sync there will be nothing done in this event
    await sleep(minTimePeriodForContractWrite + 1)

    const expectedNewNav4 = expectedNewNav3 // No activity

    results = await pnlReporter.mainService({
      nav: expectedNewNav4,
      timestamp: Math.floor(Date.now() / 1000)
    })

    // NOTE: No performance fee should be taken since NAV hasn't exceeded HWM
    expect(results).toBeTruthy()
    expect(results.delta).toBe(BigInt(0))
    expect(results.percentageChange).toBeCloseTo(0, 2)
    expect(results.txResults).toBeFalsy()
    expect(results.code).toBe(MainServiceJobResultsCode.DELTA_ZERO_NO_WRITE)
    expect(results.profitEntry).toBe(null)

    // Fifth Iteration: NAV recovers to profit higher than HWM
    // We should resume taking fees and reporting as usual
    await sleep(minTimePeriodForContractWrite + 1)

    const percentageIncrease3 = 2
    const newNavData5 = createNewNavData(
      {
        nav: expectedNewNav4,
        timestamp: Math.floor(Date.now() / 1000)
      },
      percentageIncrease3,
      1
    )

    results = await pnlReporter.mainService(newNavData5)

    expect(results).toBeTruthy()

    expect(results.delta).toBe(newNavData5.nav - expectedNewNav4)
    expect(results.percentageChange).toBeCloseTo(percentageIncrease3, 2)
    expect(results.txResults).toBeTruthy()
    expect(results.code).toBe(MainServiceJobResultsCode.PERCENTAGE_CHANGE_THRESHOLD_REACHED)

    // Calculate the new profitAboveHWM and performance fees
    const profitAboveHWM2 = newNavData5.nav - initialHighWaterMark

    const performanceFeePercentageDecimal =
      parseFloat(process.env.PERFORMANCE_FEE_PERCENTAGE!) / 100

    const profitPerformanceFee2 = BigInt(
      Math.floor(Number(profitAboveHWM2) * performanceFeePercentageDecimal)
    )
    const profitInvestors2 = profitAboveHWM2 - profitPerformanceFee2

    expect(results.profitEntry).toBeTruthy()
    expect(results.profitEntry?.profitTotal).toBe(profitAboveHWM2)
    expect(results.profitEntry?.profitInvestors).toBe(profitInvestors2)
    expect(results.profitEntry?.profitPerformanceFee).toBe(profitPerformanceFee2)

    const newHighWaterMark = newNavData5.nav - profitPerformanceFee2
    expect(results.highWaterMark).toBe(newHighWaterMark)

    const expectedNewNav5 = newNavData5.nav - profitPerformanceFee2
    expect(await pnlReporter.blockchainConnection?.contract.vaultAssets()).toBe(expectedNewNav5)
  }, 1000000)

  async function percentageChangeTriggerTest(percentageChange: number) {
    await pnlReporter.initialize()
    let vaultAssets: bigint = await pnlReporter.blockchainConnection?.contract.vaultAssets()
    console.log('Initial vaultAssets', vaultAssets.toString())

    // First run these values are the same
    let highWaterMark: bigint = vaultAssets
    let previousNav: bigint = vaultAssets

    const newNavData = createNewNavData(
      { nav: previousNav, timestamp: Math.floor(Date.now() / 1000) },
      percentageChange,
      1
    )
    console.log('New NAV Data:', newNavData)

    const results = await pnlReporter.mainService(newNavData)

    const delta = newNavData.nav - previousNav

    expect(results).toBeTruthy()
    expect(results.delta).toBe(delta)
    expect(results.percentageChange as number).toBeCloseTo(percentageChange, 2)
    expect(results.txResults).toBeTruthy()
    expect(results.code).toBe(MainServiceJobResultsCode.PERCENTAGE_CHANGE_THRESHOLD_REACHED)

    const postData = await getPnlReporterData()
    expect(postData?.id).toEqual('singleton')
    expect(postData?.previousContractWriteTimeStamp).toEqual(results.txResults?.txTimestamp)
    expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
    expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)

    const profitAboveHWM = newNavData.nav - highWaterMark

    let amountToAddToVaultAssets: bigint
    let profitPerformanceFee = BigInt(0)

    if (profitAboveHWM > BigInt(0)) {
      // There is profit above HWM, calculate performance fees on profitAboveHWM
      const performanceFeeDecimal = (pnlReporter.PERFORMANCE_FEE_PERCENTAGE / 100) as number
      profitPerformanceFee = BigInt(Math.floor(Number(profitAboveHWM) * performanceFeeDecimal))
      const profitInvestors = delta - profitPerformanceFee

      amountToAddToVaultAssets = delta - profitPerformanceFee

      expect(results.profitEntry).toBeTruthy()
      expect(results.profitEntry?.profitTotal).toBe(profitAboveHWM)
      expect(results.profitEntry?.profitInvestors).toBe(profitInvestors)
      expect(results.profitEntry?.profitPerformanceFee).toBe(profitPerformanceFee)

      highWaterMark = newNavData.nav - profitPerformanceFee

      expect(results.highWaterMark).toBe(highWaterMark)
    } else {
      // No profit above HWM, no performance fees
      amountToAddToVaultAssets = delta
      expect(results.profitEntry).toBeFalsy()

      // HWM remains unchanged
      expect(results.highWaterMark).toBe(highWaterMark)
    }

    vaultAssets = await pnlReporter.blockchainConnection?.contract.vaultAssets()
    expect(vaultAssets).toBe(previousNav + amountToAddToVaultAssets)

    // Adjust for fees taken
    previousNav = newNavData.nav - profitPerformanceFee

    return {
      nav: previousNav,
      timestamp: results.txResults?.txTimestamp || newNavData.timestamp,
      highWaterMark: highWaterMark,
      vaultAssets: vaultAssets
    }
  }
})
