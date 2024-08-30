import { FractalityPnlReporter,OperationMode,NavDataFromApi,MainServiceJobResults,MainServiceJobResultsCode } from './../src/pnlReporter';

import { getPnlReporterData,PnlReporterData,deletePnlReporterData,updatePnlReporterData } from '../src/database';
import FractalityV2VaultABI from '../contracts/FractalityV2Vault.json';
import dotenv from 'dotenv';
dotenv.config();

//ENV VARS
let GET_NAV_URL: string = '';
let API_KEY: string = '';
let VAULT_ADDRESS: string = '';
let PRIVATE_KEY: string = '';
let RPC_URL: string = '';
let TIME_PERIOD_FOR_CONTRACT_WRITE: number = 0; //milliseconds
let PERCENTAGE_TRIGGER_CHANGE: number = 0;

function _parseEnvVars() {
    if (!process.env?.GET_NAV_URL) {
        throw new Error('GET_NAV_URL is not set');
    } else {
        GET_NAV_URL = process.env.GET_NAV_URL;
    }

    if (!process.env?.PERCENTAGE_TRIGGER_CHANGE) {
        throw new Error('PERCENTAGE_TRIGGER_CHANGE is not set');
    } else {
        PERCENTAGE_TRIGGER_CHANGE = parseFloat(process.env.PERCENTAGE_TRIGGER_CHANGE);
    }

    if (!process.env?.TIME_PERIOD_FOR_CONTRACT_WRITE) {
        throw new Error('TIME_PERIOD_FOR_CONTRACT_WRITE is not set');
    } else {
        TIME_PERIOD_FOR_CONTRACT_WRITE = parseInt(process.env.TIME_PERIOD_FOR_CONTRACT_WRITE);
    }
    if (!process.env?.API_KEY) {
        throw new Error('API_KEY is not set');
    } else {
        API_KEY = process.env.API_KEY;
    }

    if (!process.env?.VAULT_ADDRESS && !process.env?.TEST_VAULT_ADDRESS ) {
        throw new Error('VAULT_ADDRESS is not set');
    } else {
        if(process.env.UNIT_TEST_MODE){
            VAULT_ADDRESS = process.env.TEST_VAULT_ADDRESS as string;
        }else{
            VAULT_ADDRESS = process.env.VAULT_ADDRESS as string;
        }        
    }

    if (!process.env?.PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY is not set');
    } else {
        PRIVATE_KEY = process.env.PRIVATE_KEY;
    }

    if (!process.env?.RPC_URL) {
        throw new Error('RPC_URL is not set');
    } else {
        RPC_URL = process.env.RPC_URL;
    }
}


function createNewPnlReporterData(previousPnlReporterData: PnlReporterData, desiredPercentageChange: number,desiredTimeDeltaSecs: number):NavDataFromApi { 
    if(!previousPnlReporterData.previousProcessedNavTimeStamp ){
        throw new Error('Failure - the previousProcessedNavTimeStamp is not set, should have been set at initialization');
    }
    if(!previousPnlReporterData.previousProcessedNav){
        throw new Error('Failure - the previousProcessedNav is not set, should have been set at initialization');
    }
    const newNavTimeStamp:number = previousPnlReporterData.previousProcessedNavTimeStamp + desiredTimeDeltaSecs;
    const newNav:number = parseFloat(previousPnlReporterData.previousProcessedNav) * (1 + (desiredPercentageChange / 100));
    return {
        nav: newNav,
        timestamp: newNavTimeStamp
    } as NavDataFromApi
}

//NOTE: NON KMS, which is impossible to test locally.
describe('FractalityPnlReporter - NON KMS', () => {
  let pnlReporter: FractalityPnlReporter;

    beforeAll(() => {
        _parseEnvVars();
    });


    beforeEach(async () => {
        //push mode, only the initial nav is pulled from the API the rest needs to be pushed.
        pnlReporter = new FractalityPnlReporter(
            GET_NAV_URL,
            API_KEY,
            VAULT_ADDRESS,
            PRIVATE_KEY,
            RPC_URL,
            TIME_PERIOD_FOR_CONTRACT_WRITE,
            PERCENTAGE_TRIGGER_CHANGE,
            FractalityV2VaultABI.abi,
            OperationMode.PUSH
        );
    });

    afterEach(async () => {
        //teardown
        await deletePnlReporterData();
    });


  
  test('When there is no pnlReporterData in the database, the initialization works with fresh data', async () => {

    //delete the pnlReporterData from the database, we want to start from scratch
    await deletePnlReporterData();

    await pnlReporter.initialize();

    const initialPnlReporterData = await getPnlReporterData();

    if (!initialPnlReporterData) {
      throw new Error('Initial PnlReporterData is null');
    }

    expect(initialPnlReporterData).toBeTruthy();
    expect(initialPnlReporterData.previousProcessedNav).not.toBeNull();
    expect(initialPnlReporterData.previousProcessedNavTimeStamp).not.toBeNull();
    expect(initialPnlReporterData.previousContractWriteTimeStamp).toEqual(0);


  })

  test('When there is a pnlReporterData already in the database, the initialization works with the old data', async () => {
    //update with dummy data to test initialization
    await updatePnlReporterData(123,123,123);

    await pnlReporter.initialize();

    const initialPnlReporterData = await getPnlReporterData();

    if (!initialPnlReporterData) {
      throw new Error('Initial PnlReporterData is null');
    }

    expect(initialPnlReporterData).toBeTruthy();
    expect(initialPnlReporterData.previousProcessedNav).toEqual('123');
    expect(initialPnlReporterData.previousProcessedNavTimeStamp).toEqual(123);
    expect(initialPnlReporterData.previousContractWriteTimeStamp).toEqual(123);

  })




  test('No percentage change at all', async () => {

    await pnlReporter.initialize();

    const initialPnlReporterData = await getPnlReporterData();

    if(!initialPnlReporterData){
        throw new Error('Failure - the initial pnlReporterData is null, should have been set at initialization');
    }

    const newNavData:NavDataFromApi = createNewPnlReporterData(initialPnlReporterData,0,0);

    const results:MainServiceJobResults=await pnlReporter.mainService(newNavData);

    expect(results).toBeTruthy();
    expect(results.code).toBe(MainServiceJobResultsCode.DELTA_ZERO_NO_WRITE);
    expect(results.delta).toBe(0);
    expect(results.percentageChange).toBe(0);
    expect(results.txResults).toBeNull();
 
  });
  

});

