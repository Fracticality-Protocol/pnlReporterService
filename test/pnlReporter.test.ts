import {
  FractalityPnlReporter,
  NavDataFromApi,
  MainServiceJobResults,
  MainServiceJobResultsCode
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

function createNewPnlReporterData(
  previousPnlReporterData: PnlReporterData,
  desiredPercentageChange: number,
  desiredTimeDeltaSecs: number
): NavDataFromApi {
  if (!previousPnlReporterData.previousProcessedNavTimeStamp) {
    throw new Error(
      'Failure - the previousProcessedNavTimeStamp is not set, should have been set at initialization'
    )
  }
  if (!previousPnlReporterData.previousProcessedNav) {
    throw new Error(
      'Failure - the previousProcessedNav is not set, should have been set at initialization'
    )
  }
  const newNavTimeStamp: number =
    previousPnlReporterData.previousProcessedNavTimeStamp + desiredTimeDeltaSecs
  const newNav: number =
    parseFloat(previousPnlReporterData.previousProcessedNav) * (1 + desiredPercentageChange / 100)
  return {
    nav: newNav,
    timestamp: newNavTimeStamp
  } as NavDataFromApi
}

//NOTE: NON KMS, which is impossible to test locally.
describe('FractalityPnlReporter - NON KMS', () => {
  let pnlReporter: FractalityPnlReporter

  beforeEach(async () => {
    //push mode, only the initial nav is pulled from the API the rest needs to be pushed.
    pnlReporter = new FractalityPnlReporter(
      env,
      FractalityV2VaultABI.abi,
      OperationMode.PUSH,
      KeyMode.PRIVATE_KEY
    )
  })

  afterEach(async () => {
    //teardown
    await deletePnlReporterData()
  })

  test('When there is no pnlReporterData in the database, the initialization works with fresh data', async () => {
    //delete the pnlReporterData from the database, we want to start from scratch
    await deletePnlReporterData()

    await pnlReporter.initialize()

    const initialPnlReporterData = await getPnlReporterData()

    if (!initialPnlReporterData) {
      throw new Error('Initial PnlReporterData is null')
    }

    expect(initialPnlReporterData).toBeTruthy()
    expect(initialPnlReporterData.previousProcessedNav).not.toBeNull()
    expect(initialPnlReporterData.previousProcessedNavTimeStamp).not.toBeNull()
    expect(initialPnlReporterData.previousContractWriteTimeStamp).toEqual(0)
  })

  test('When there is a pnlReporterData already in the database, the initialization works with the old data', async () => {
    //update with dummy data to test initialization
    await updatePnlReporterData(123, 123, 123)

    await pnlReporter.initialize()

    const initialPnlReporterData = await getPnlReporterData()

    if (!initialPnlReporterData) {
      throw new Error('Initial PnlReporterData is null')
    }

    expect(initialPnlReporterData).toBeTruthy()
    expect(initialPnlReporterData.previousProcessedNav).toEqual('123')
    expect(initialPnlReporterData.previousProcessedNavTimeStamp).toEqual(123)
    expect(initialPnlReporterData.previousContractWriteTimeStamp).toEqual(123)
  })

  test('No percentage change at all', async () => {
    await pnlReporter.initialize()

    const initialPnlReporterData = await getPnlReporterData()

    if (!initialPnlReporterData) {
      throw new Error(
        'Failure - the initial pnlReporterData is null, should have been set at initialization'
      )
    }

    const newNavData: NavDataFromApi = createNewPnlReporterData(initialPnlReporterData, 0, 0)

    const results: MainServiceJobResults = await pnlReporter.mainService(newNavData)

    expect(results).toBeTruthy()
    expect(results.code).toBe(MainServiceJobResultsCode.DELTA_ZERO_NO_WRITE)
    expect(results.delta).toBe(0)
    expect(results.percentageChange).toBe(0)
    expect(results.txResults).toBeNull()
  })
})
