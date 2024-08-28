import { CronJob } from 'cron';
import dotenv from 'dotenv';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { ethers } from 'ethers';
import FractalityV2VaultABI from '../contracts/FractalityV2Vault.json';

dotenv.config();


import { updatePnlReporterData, getPnlReporterData } from './database';

axiosRetry(axios, {
    retries: 5, retryDelay: axiosRetry.exponentialDelay, onRetry: (retryCount, error) => {
        console.log(`Retrying request (attempt ${retryCount + 1}): ${error.message}`);
    }
});
const client = axios.create();
let job: CronJob;
let blockchainConnection: BlockchainConnection;


//ENV VARS
let GET_NAV_URL: string;
let API_KEY: string;
let VAULT_ADDRESS: string;
let PRIVATE_KEY: string;
let RPC_URL: string;
let TIME_PERIOD_FOR_CONTRACT_WRITE: number; //milliseconds
let PERCENTAGE_TRIGGER_CHANGE: number;


//TYPES
interface RawNavData {
    nav: string;//string representation of a floating point number
    timestamp: number; //timestamp (seconds)
}

interface ProcessedNavData {
    nav: number; //floating point number
    timestamp: number; //timestamp (seconds)
}

interface BlockchainConnection {
    contract: ethers.Contract;
    signer: ethers.Signer;
    provider: ethers.JsonRpcProvider;
    assetDecimals: BigInt;
}


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

    if (!process.env?.VAULT_ADDRESS) {
        throw new Error('VAULT_ADDRESS is not set');
    } else {
        VAULT_ADDRESS = process.env.VAULT_ADDRESS;
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

async function _initBlockchainConnection(): Promise<BlockchainConnection> {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(VAULT_ADDRESS, FractalityV2VaultABI.abi, signer);
    console.log("connected to blockchain");
    const assetAddress = await contract.asset();

    const assetContract = new ethers.Contract(assetAddress, ['function decimals() view returns (uint8)'], signer);
    const assetDecimals = await assetContract.decimals();

    return { contract, signer, provider, assetDecimals: assetDecimals }
}


async function getNavData(url: string): Promise<RawNavData> {
    try {
        const response = await client.get(url, {
            headers: {
                'x-api-key': API_KEY
            }
        });

        return response.data;
    } catch (error: unknown) {
        if (axios.isAxiosError(error)) {
            throw new Error(`Failed to get nav data: ${error.message}`);
        } else {
            console.error('An unexpected error occurred:', error);
            throw error;
        }
    }
}

async function processNavData(rawNavData: RawNavData): Promise<ProcessedNavData> {
    const nav = parseFloat(rawNavData.nav);
    return { nav, timestamp: rawNavData.timestamp };
}

async function init() {
    try {
        _parseEnvVars()
        blockchainConnection = await _initBlockchainConnection();
        // Create the cron job
        job = new CronJob(
            '* * * * *', // Cron expression: Run every minute
            jobRunner,      // Function to execute
            null,        // onComplete function (null if not needed)
            false,        // Start the job right now
            'UTC'        // Time zone
        );

        const pnlReporterData = await getPnlReporterData();
        if (!pnlReporterData) {
            const initNavData = await getNavData(GET_NAV_URL);
            const processedNavData = await processNavData(initNavData);

            //0 previousContractWriteTimeStamp because this is the first time the service is being run
            await updatePnlReporterData(0, processedNavData.nav, processedNavData.timestamp);

            console.log("initialized with initial nav data");
            console.log(processedNavData);
        } else {
            console.log("initialized with existing nav data");
            console.log(pnlReporterData);
        }

        console.info('Job scheduler started');
        job.start();
    } catch (error) {
        console.error('Error initializing PNL Reporter Service', error);
        throw error;
    }
}
init();

//ASSUMES THAT THERE IS ALREADY A PREVIOUS NAV DATA, OBTAINED AT INIT TIME.
async function main(): Promise<void> {

    console.log(`
        ┌─────────────────────────┐
        │    PNL REPORTER JOB     │
        │                         │
        │         $$$$$           │
        │       $$     $$         │
        │      $   $$$   $        │
        │      $  $   $  $        │
        │      $   $$$   $        │
        │       $$     $$         │
        │         $$$$$           │
        │                         │
        └─────────────────────────┘
        `);


    //fetch new nav data from the api 
    const newNavData = await getNavData(GET_NAV_URL);
    //process the new nav data
    const newProcessedNavData = await processNavData(newNavData);

    //get the previous nav data from the database
    const pnlReporterData = await getPnlReporterData();

    if (!pnlReporterData) {
        throw new Error("pnlReporterData not found, should have been initialized at startup");
    }

    //this looks ulgy here
    const previousProcessedNavData = {
        nav: parseFloat(pnlReporterData.previousProcessedNav as string),
        timestamp: pnlReporterData.previousProcessedNavTimeStamp as number
    } as ProcessedNavData

    //calculate the percentage change and delta
    const percentageChange = await calculatePercentageChange(newProcessedNavData, previousProcessedNavData as ProcessedNavData);
    const delta = await calculateDelta(newProcessedNavData, previousProcessedNavData as ProcessedNavData);

    console.log("previousProcessedNavData");
    console.log(previousProcessedNavData);

    console.log("newProcessedNavData");
    console.log(newProcessedNavData);

    console.log("percentageChange", percentageChange);
    console.log("delta", delta);

    //BUSINESS LOGIC - logic to write to contract
    //if percentageTriggerChange is reached, in either direction, write detla to contract
    //else, check if previousContractWriteTimeStamp is set.
    //if it's not set, write detla to contract
    //if it is set, check to see if the time difference between now and previousContractWriteTimeStamp is 10 minutes or greater.
    //if it is, write delta to contract
    //write current timestamp to previousContractWriteTimeStamp
    //if it's not, do nothing

    let txTimestamp = pnlReporterData?.previousContractWriteTimeStamp as number;

    if (delta === 0) {
        console.log("delta is zero - no action taken");
    } else {

        let shouldUpdateContract: boolean = false;

        if (Math.abs(percentageChange) >= PERCENTAGE_TRIGGER_CHANGE) {
            shouldUpdateContract = true;
        }
        const timeSinceLastContractWrite = new Date().getTime() - (pnlReporterData?.previousContractWriteTimeStamp as number);
        if (timeSinceLastContractWrite > TIME_PERIOD_FOR_CONTRACT_WRITE) {
            shouldUpdateContract = true;
        }

        if (shouldUpdateContract) {
            txTimestamp = await writeToContract(delta);
        } else {
            console.log("not enough time has passed since last contract write, nor is the percentage change threshold reached");
        }
    }

    //update the pnlReporterData with every single time, even if no transaction took place.
    //which scenarios are this this? Not enough time has passed, or percentage change is not reached.
    await updatePnlReporterData(txTimestamp, newProcessedNavData.nav, newProcessedNavData.timestamp);
    console.log("finished job");

}

async function writeToContract(delta: number): Promise<number> {
    console.log("writing to contract");
    let tx;
    if (delta > 0) {
        console.log("delta is positive - reporting profit");

        const deltaInAssetUnits = ethers.parseUnits(delta.toString(), Number(blockchainConnection.assetDecimals));
        console.log("deltaInAssetUnits", deltaInAssetUnits);
        tx = await blockchainConnection.contract.reportProfits(deltaInAssetUnits, "pnlReporterService");



    } else if (delta < 0) {
        console.log("delta is negative - reporting loss");

        const deltaInAssetUnits = ethers.parseUnits(Math.abs(delta).toString(), Number(blockchainConnection.assetDecimals));
        console.log("deltaInAssetUnits", deltaInAssetUnits);
        tx = await blockchainConnection.contract.reportLosses(deltaInAssetUnits, "pnlReporterService");

    }
    const receipt = await tx.wait();
    console.log("hash", receipt.hash);
    const block = await blockchainConnection.provider.getBlock(receipt.blockNumber);
    return block?.timestamp as number;
}


async function calculatePercentageChange(newProcessedNavData: ProcessedNavData, previousProcessedNavData: ProcessedNavData): Promise<number> {
    const percentageChange = ((newProcessedNavData.nav - previousProcessedNavData.nav) / previousProcessedNavData.nav) * 100;
    return percentageChange;
}

async function calculateDelta(newProcessedNavData: ProcessedNavData, previousProcessedNavData: ProcessedNavData): Promise<number> {
    const delta = newProcessedNavData.nav - previousProcessedNavData.nav;
    return delta;
}

export async function jobRunner(): Promise<void> {
    try {
        await main();
    } catch (error) {
        console.error('Job failed', { error });
    }
}


process.on('SIGINT', () => {
    console.info('Stopping job');
    job.stop();
    process.exit(0);
});
