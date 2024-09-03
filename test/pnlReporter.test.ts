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

function createNewNavData(
    previousPnlReporterData: NavDataFromApi,
    desiredPercentageChange: number,
    desiredTimeDeltaSecs: number
): NavDataFromApi {
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
    const newNav: number = previousPnlReporterData.nav * (1 + desiredPercentageChange / 100)
    return {
        nav: newNav,
        timestamp: newNavTimeStamp
    } as NavDataFromApi
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

    beforeEach(() => {
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
        const data = await getPnlReporterData()
        expect(data).toBeUndefined()
    })

    test('Push mode - requires initial nav data', async () => {
        await expect(pnlReporter.initialize()).rejects.toThrow(
            'Missing nav data, necessary for push mode'
        )
    })

    test('MainService fails if no pnlReporterData in database', async () => {
        const initialNavData: NavDataFromApi = {
            nav: 1000000,
            timestamp: Math.floor(new Date().getTime() / 1000)
        }

        await pnlReporter.initialize(initialNavData)

        await deletePnlReporterData()
        await expect(pnlReporter.mainService(initialNavData)).rejects.toThrow(
            'pnlReporterData not found, should have been initialized at startup'
        )
    })

    test('When there is no pnlReporterData in the database, the initialization works with fresh data (perfoms no delta job)', async () => {
        const initialNavData: NavDataFromApi = {
            nav: 1000000,
            timestamp: Math.floor(new Date().getTime() / 1000)
        }

        const results = await pnlReporter.initialize(initialNavData)
        expect(results).toBeTruthy()
        if (!results) throw new Error('Results is null')

        const initialPnlReporterData = await getPnlReporterData()

        if (!initialPnlReporterData) {
            throw new Error('Initial PnlReporterData is null')
        }

        expect(initialPnlReporterData).toBeTruthy()
        expect(initialPnlReporterData.previousProcessedNav).toEqual(initialNavData.nav.toString())
        expect(initialPnlReporterData.previousProcessedNavTimeStamp).toEqual(initialNavData.timestamp)
        expect(initialPnlReporterData.previousContractWriteTimeStamp).toEqual(0)

        expect(results).toBeTruthy()
        expect(results.delta as number).toBe(0)
        expect(results.percentageChange as number).toBe(0)
        expect(results.txResults).toBeNull()
        expect(results.code).toBe(MainServiceJobResultsCode.DELTA_ZERO_NO_WRITE)
    })

    test('When there is a pnlReporterData already in the database, the initialization works with the new provided data and performs expected job', async () => {
        const initialNavData: NavDataFromApi = {
            nav: 1000000,
            timestamp: Math.floor(new Date().getTime() / 1000)
        }

        //update with dummy data to test initialization
        await updatePnlReporterData(0, initialNavData.nav, initialNavData.timestamp)

        const timeDeltaSecs = 10
        const timePercentageChange = 100

        const newNavData: NavDataFromApi = createNewNavData(
            initialNavData,
            timePercentageChange,
            timeDeltaSecs
        )

        await pnlReporter.initialize(newNavData)

        const initialPnlReporterData = await getPnlReporterData()

        if (!initialPnlReporterData) {
            throw new Error('Initial PnlReporterData is null')
        }

        expect(initialPnlReporterData).toBeTruthy()
        expect(initialPnlReporterData.previousProcessedNav).toEqual((initialNavData.nav * 2).toString())
        expect(initialPnlReporterData.previousProcessedNavTimeStamp).toEqual(
            initialNavData.timestamp + timeDeltaSecs
        )
        expect(initialPnlReporterData.previousContractWriteTimeStamp).not.toBe(0)
    })

    test('No percentage change at all', async () => {
        const initialNavData: NavDataFromApi = {
            nav: 1000000,
            timestamp: Math.floor(new Date().getTime() / 1000)
        }

        await pnlReporter.initialize(initialNavData)
        const originalData = await getPnlReporterData()

        const newNavData: NavDataFromApi = {
            nav: parseFloat(originalData?.previousProcessedNav as string),
            timestamp: (originalData?.previousProcessedNavTimeStamp as number) + 60
        }
        const results = await pnlReporter.mainService(newNavData)

        expect(results).toBeTruthy()
        expect(results.delta as number).toBe(0)
        expect(results.percentageChange as number).toBe(0)
        expect(results.txResults).toBeNull()
        expect(results.code).toBe(MainServiceJobResultsCode.DELTA_ZERO_NO_WRITE)

        const postData = await getPnlReporterData()
        expect(postData?.id).toEqual(originalData?.id)
        expect(postData?.previousContractWriteTimeStamp).toEqual(
            originalData?.previousContractWriteTimeStamp
        )
        expect(postData?.previousProcessedNav).toEqual(originalData?.previousProcessedNav)
        expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)
    })

    test('percentage change (positive) triggers a write to the contract', async () => {
        const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
        await percentageChangeTriggerTest(minPercentageChange);
    })

    
    test('percentage change (negative) triggers a write to the contract', async () => {
        const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
        await percentageChangeTriggerTest(-minPercentageChange);
    })
    

    test('time threshhold change triggers a write to the contract (positive)', async () => {
        const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
        const prevNavData = await percentageChangeTriggerTest(minPercentageChange);

        const minTimePeriodForContractWrite = parseFloat(
            process.env.TIME_PERIOD_FOR_CONTRACT_WRITE as string
        )

        //this is the first initial write, 1 seconds after the initialization, due to the min percentage being breached
        const newNavData = createNewNavData(prevNavData, minPercentageChange - 0.1, minTimePeriodForContractWrite)

 
        console.log("sleeping for ", minTimePeriodForContractWrite, " seconds to match blockchain time")
        await sleep(minTimePeriodForContractWrite)

        const preData = await getPnlReporterData()

        const results = await pnlReporter.mainService(newNavData)
        console.log('results: ', results)

        expect(results).toBeTruthy()
        expect(results.delta as number).toBe(1503.75)
        expect(results.percentageChange as number).toBe(minPercentageChange-0.1)
        expect(results.txResults).toBeTruthy()
        expect(results.code).toBe(MainServiceJobResultsCode.TIME_SINCE_LAST_CONTRACT_WRITE_THRESHOLD_REACHED_WRITE)

        const postData = await getPnlReporterData()
        expect(postData?.id).toEqual(preData?.id)
        expect(postData?.previousContractWriteTimeStamp).toEqual(results.txResults?.txTimestamp)
        expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
        expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)

    })


    test('time threshhold change triggers a write to the contract (negative)', async () => {
        const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)
        const prevNavData = await percentageChangeTriggerTest(minPercentageChange);

        const minTimePeriodForContractWrite = parseFloat(
            process.env.TIME_PERIOD_FOR_CONTRACT_WRITE as string
        )

        const newNavData = createNewNavData(prevNavData,  0.1-minPercentageChange, minTimePeriodForContractWrite)

        console.log("sleeping for ", minTimePeriodForContractWrite, " seconds to match blockchain time")
        await sleep(minTimePeriodForContractWrite)

        const preData = await getPnlReporterData()

        const results = await pnlReporter.mainService(newNavData)
        console.log('results: ', results)

        const delta = newNavData.nav-prevNavData.nav

        expect(results).toBeTruthy()
        expect(results.delta as number).toBe(delta)
        expect(results.percentageChange as number).toBe(0.1-minPercentageChange)
        expect(results.txResults).toBeTruthy()
        expect(results.code).toBe(MainServiceJobResultsCode.TIME_SINCE_LAST_CONTRACT_WRITE_THRESHOLD_REACHED_WRITE)

        const postData = await getPnlReporterData()
        expect(postData?.id).toEqual(preData?.id)
        expect(postData?.previousContractWriteTimeStamp).toEqual(results.txResults?.txTimestamp)
        expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
        expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)

    })

    
    test('time threshhold and percenrage change are not breached, no write to the contract', async () => {
        const minPercentageChange = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE as string)

        const prevNavData = await percentageChangeTriggerTest(minPercentageChange);

        const minTimePeriodForContractWrite = parseFloat(
            process.env.TIME_PERIOD_FOR_CONTRACT_WRITE as string
        )
        const timeDeltaSecs = 1;

        //this is the first initial write, 1 seconds after the initialization, due to the min percentage being breached
        const newNavData = createNewNavData(prevNavData, minPercentageChange - 0.1, timeDeltaSecs)

 
        console.log("sleeping for ", timeDeltaSecs, " seconds to match blockchain time")
        await sleep(timeDeltaSecs)

        const preData = await getPnlReporterData()

        const results = await pnlReporter.mainService(newNavData)
        console.log('results: ', results)

        
        expect(results).toBeTruthy()
        expect(results.delta as number).toBe(1503.75)
        expect(results.percentageChange as number).toBe(minPercentageChange-0.1)
        expect(results.txResults).toBeNull()
        expect(results.code).toBe(MainServiceJobResultsCode.NO_TRIGGER_NO_WRITE)
        
        const postData = await getPnlReporterData()
        expect(postData?.id).toEqual(preData?.id)
        expect(postData?.previousContractWriteTimeStamp).toEqual(preData?.previousContractWriteTimeStamp)
        expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
        expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)
        
    })


    async function percentageChangeTriggerTest(percentageChange: number) {
        const initialNavData: NavDataFromApi = {
            nav: 1000000,
            timestamp: Math.floor(new Date().getTime() / 1000)
        }

        await pnlReporter.initialize(initialNavData)
        const originalData = await getPnlReporterData()

        //this is the first initial write, 1 seconds after the initialization, due to the min percentage being breached
        const newNavData = createNewNavData(initialNavData, percentageChange, 1)

        const results = await pnlReporter.mainService(newNavData)
        console.log('results: ', results)

        const delta = newNavData.nav-parseFloat(originalData?.previousProcessedNav as string);

        expect(results).toBeTruthy()
        expect(results.delta as number).toBe(delta)
        expect(results.percentageChange as number).toBe(percentageChange)
        expect(results.txResults).toBeTruthy()
        expect(results.code).toBe(MainServiceJobResultsCode.PERCENTAGE_CHANGE_THRESHOLD_REACHED)

        const postData = await getPnlReporterData()
        expect(postData?.id).toEqual(originalData?.id)
        expect(postData?.previousContractWriteTimeStamp).toEqual(results.txResults?.txTimestamp)
        expect(postData?.previousProcessedNav).toEqual(newNavData.nav.toString())
        expect(postData?.previousProcessedNavTimeStamp).toEqual(newNavData.timestamp)

        return newNavData;
    }



})
