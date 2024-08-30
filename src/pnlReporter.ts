import { ethers } from 'ethers';
import { AwsKmsSigner } from "@cuonghx.gu-tech/ethers-aws-kms-signer";
import { updatePnlReporterData, getPnlReporterData, PnlReporterData, initializeDatabaseConnection } from './database';
import axios from 'axios';
import { AxiosInstance } from 'axios';
import { CronJob } from 'cron';

import axiosRetry from 'axios-retry';

export interface NavDataFromApi {
    nav: number;//string representation of a floating point number
    timestamp: number; //timestamp (seconds)
}

interface BlockchainConnection {
    contract: ethers.Contract;
    signer: ethers.Signer | AwsKmsSigner;
    provider: ethers.JsonRpcProvider;
    assetDecimals: BigInt;
}

interface KmsCredentials {
    keyId: string;
    region: string;
    credentials: {
        accessKeyId: string;
        secretAccessKey: string;
    };
}

export enum OperationMode {
    PUSH = 'push',
    PULL = 'pull'
}

export enum MainServiceJobResultsCode {
    DELTA_ZERO_NO_WRITE = "delta is zero - not writing to contract",
    PERCENTAGE_CHANGE_THRESHOLD_REACHED = "percentage change threshold reached - writing to contract",
    TIME_SINCE_LAST_CONTRACT_WRITE_THRESHOLD_REACHED_WRITE = "time since last contract write threshold reached - writing to contract",
    NO_TRIGGER_NO_WRITE = "delta is not zero, percentage change threshold not reached, and time since last contract write threshold not reached",
}

export interface MainServiceJobResults {
    delta: number,
    percentageChange: number,
    txResults: WriteToContractResults | null
    code: string
}

export interface WriteToContractResults {
    txTimestamp: number
    hash: string
}


export class FractalityPnlReporter {

    #GET_NAV_URL: string;
    #API_KEY: string;
    VAULT_ADDRESS: string;
    #PRIVATE_KEY: string;
    #RPC_URL: string;
    TIME_PERIOD_FOR_CONTRACT_WRITE: number; //milliseconds
    PERCENTAGE_TRIGGER_CHANGE: number;
    FRACTALITY_V2_VAULT_ABI: ethers.InterfaceAbi;
    OPERATION_MODE: OperationMode;

    blockchainConnection: BlockchainConnection | null;
    #client: AxiosInstance | null;
    #job: CronJob | null;
    #kmsCredentials: KmsCredentials | null;

    //NOTE: only the pull mode is currently supported for now
    constructor(_GET_NAV_URL: string, _API_KEY: string, _VAULT_ADDRESS: string, _PRIVATE_KEY: string, _RPC_URL: string, _TIME_PERIOD_FOR_CONTRACT_WRITE: number, _PERCENTAGE_TRIGGER_CHANGE: number, _FRACTALITY_V2_VAULT_ABI: ethers.InterfaceAbi, _OPERATION_MODE: OperationMode = OperationMode.PULL) {
        this.#GET_NAV_URL = _GET_NAV_URL;
        this.#API_KEY = _API_KEY;
        this.VAULT_ADDRESS = _VAULT_ADDRESS;
        this.#PRIVATE_KEY = _PRIVATE_KEY;
        this.#RPC_URL = _RPC_URL;
        this.TIME_PERIOD_FOR_CONTRACT_WRITE = _TIME_PERIOD_FOR_CONTRACT_WRITE;
        this.PERCENTAGE_TRIGGER_CHANGE = _PERCENTAGE_TRIGGER_CHANGE;
        this.FRACTALITY_V2_VAULT_ABI = _FRACTALITY_V2_VAULT_ABI;
        this.blockchainConnection = null;
        this.#client = null;
        this.#job = null;
        this.OPERATION_MODE = _OPERATION_MODE;
        this.#kmsCredentials = null;
    }

    _calculatePercentageChange = async (newNavData: NavDataFromApi, previousNavData: PnlReporterData): Promise<number> => {
        const previousProcessedNavData = parseFloat(previousNavData.previousProcessedNav as string);
        const percentageChange = ((newNavData.nav - previousProcessedNavData) / previousProcessedNavData) * 100;
        return percentageChange;
    }

    _calculateDelta = (newNav: number, oldNav: number): number => {
        return newNav - oldNav;
    }


    _writeToContract = async (delta: number): Promise<WriteToContractResults> => {
        if (!this.blockchainConnection) throw new Error("Blockchain connection not initialized");

        console.log("writing to contract");
        let tx;
        if (delta > 0) {
            console.log("delta is positive - reporting profit");

            const deltaInAssetUnits = ethers.parseUnits(delta.toString(), Number(this.blockchainConnection.assetDecimals));
            console.log("deltaInAssetUnits", deltaInAssetUnits);
            tx = await this.blockchainConnection.contract.reportProfits(deltaInAssetUnits, "pnlReporterService");



        } else if (delta < 0) {
            console.log("delta is negative - reporting loss");

            const deltaInAssetUnits = ethers.parseUnits(Math.abs(delta).toString(), Number(this.blockchainConnection.assetDecimals));
            console.log("deltaInAssetUnits", deltaInAssetUnits);
            tx = await this.blockchainConnection.contract.reportLosses(deltaInAssetUnits, "pnlReporterService");

        }
        const receipt = await tx.wait();

        console.log("tx hash", receipt.hash);
        const block = await this.blockchainConnection.provider.getBlock(receipt.blockNumber);

        return {
            txTimestamp: block?.timestamp as number,
            hash: receipt.hash
        }
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
    mainService = async (newNavData: NavDataFromApi): Promise<MainServiceJobResults> => {
        let code: MainServiceJobResultsCode = MainServiceJobResultsCode.NO_TRIGGER_NO_WRITE;
        this._drawLogo()

        //get the previous nav data from the database
        const pnlReporterData = await getPnlReporterData();

        if (!pnlReporterData) {
            throw new Error("pnlReporterData not found, should have been initialized at startup");
        }

        //calculate the percentage change and delta
        const percentageChange = await this._calculatePercentageChange(newNavData, pnlReporterData);
        const delta = await this._calculateDelta(newNavData.nav, parseFloat(pnlReporterData.previousProcessedNav as string));

        let txTimestamp = pnlReporterData?.previousContractWriteTimeStamp as number;
        let txResults: WriteToContractResults | null = null;

        if (delta === 0) {
            code = MainServiceJobResultsCode.DELTA_ZERO_NO_WRITE
            console.log(code);
        } else {

            let shouldUpdateContract: boolean = false;

            if (Math.abs(percentageChange) >= this.PERCENTAGE_TRIGGER_CHANGE) {
                code = MainServiceJobResultsCode.PERCENTAGE_CHANGE_THRESHOLD_REACHED
                shouldUpdateContract = true;
            } else {
                const timeSinceLastContractWrite = new Date().getTime() - (pnlReporterData?.previousContractWriteTimeStamp as number);
                if (timeSinceLastContractWrite > this.TIME_PERIOD_FOR_CONTRACT_WRITE) {
                    code = MainServiceJobResultsCode.TIME_SINCE_LAST_CONTRACT_WRITE_THRESHOLD_REACHED_WRITE
                    shouldUpdateContract = true;
                }
            }

            if (shouldUpdateContract) {
                txResults = await this._writeToContract(delta);
                txTimestamp = txResults.txTimestamp;
            } else {
                code = MainServiceJobResultsCode.NO_TRIGGER_NO_WRITE
            }
        }

        //update the pnlReporterData with every single time, even if no transaction took place.
        //which scenarios are this this? Not enough time has passed, or percentage change is not reached.
        await updatePnlReporterData(txTimestamp, newNavData.nav, newNavData.timestamp);
        console.log("finished job");


        return {
            delta: delta,
            percentageChange: percentageChange,
            txResults: txResults,
            code: code
        } as MainServiceJobResults

    }

    async initialize() {
        await initializeDatabaseConnection();
        this.blockchainConnection = await this._initBlockchainConnection(this.#kmsCredentials ? true : false);

        axiosRetry(axios, {
            retries: 5, retryDelay: axiosRetry.exponentialDelay, onRetry: (retryCount, error) => {
                console.log(`Retrying request (attempt ${retryCount + 1}): ${error.message}`);
            }
        });
        this.#client = axios.create();


        const pnlReporterData = await getPnlReporterData();

        if (!pnlReporterData) {
            const initNavData = await this._getNavData();

            //0 previousContractWriteTimeStamp because this is the first time the service is being run
            await updatePnlReporterData(0, initNavData.nav, initNavData.timestamp);

            console.log("initialized with initial nav data");
            console.log(initNavData);
        } else {
            console.log("initialized with existing nav data");
            console.log(pnlReporterData);
        }

        if (this.OPERATION_MODE === OperationMode.PULL) {
            this.#job = new CronJob(
                '* * * * *', // Cron expression: Run every minute
                this._jobRunner,      // Function to execute
                null,        // onComplete function (null if not needed)
                false,        // Start the job right now
                'UTC'        // Time zone
            );
            this.#job.start();
            console.info('Job scheduler started - running pull service');
        } else {
            console.info('Running in push mode, NAV data needs to be pushed to the service.');
        }
    }


    setKMSCredentials = (kmsCredentials: KmsCredentials) => {
        if (!kmsCredentials.keyId || !kmsCredentials.region || !kmsCredentials.credentials.accessKeyId || !kmsCredentials.credentials.secretAccessKey) {
            throw new Error("Invalid KMS credentials provided");
        }
        this.#kmsCredentials = kmsCredentials;
        console.log("KMS credentials set successfully");
    }

    _jobRunner = async (): Promise<void> => {
        try {
            const newNavData = await this._getNavData();
            const results = await this.mainService(newNavData);
            console.log("job results")
            console.log(results);
        } catch (error) {
            console.error('Job failed', { error });
        }
    }

    _getNavData = async (): Promise<NavDataFromApi> => {
        if (!this.#client) throw new Error("Client not initialized");
        try {
            const response = await this.#client.get(this.#GET_NAV_URL, {
                headers: {
                    'x-api-key': this.#API_KEY
                }
            });

            return {
                nav: parseFloat(response.data.nav),
                timestamp: response.data.timestamp
            }

        } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Failed to get nav data: ${error.message}`);
            } else {
                console.error('An unexpected error occurred:', error);
                throw error;
            }
        }
    }

    _initBlockchainConnection = async (useKMS: boolean = false): Promise<BlockchainConnection> => {


        let signer: ethers.Wallet | AwsKmsSigner;
        let provider: ethers.JsonRpcProvider;

        provider = new ethers.JsonRpcProvider(this.#RPC_URL);

        if (!useKMS) {
            signer = new ethers.Wallet(this.#PRIVATE_KEY, provider);
        } else {
            if (!this.#kmsCredentials) throw new Error("KMS credentials not set");
            signer = new AwsKmsSigner(this.#kmsCredentials);
            signer = signer.connect(provider);
        }


        const contract = new ethers.Contract(this.VAULT_ADDRESS, this.FRACTALITY_V2_VAULT_ABI, signer);
        console.log("connected to blockchain");
        const assetAddress = await contract.asset();

        const assetContract = new ethers.Contract(assetAddress, ['function decimals() view returns (uint8)'], signer);
        const assetDecimals = await assetContract.decimals();

        return { contract, signer, provider, assetDecimals: assetDecimals }
    }

    _drawLogo = () => {
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
    }

}

export default FractalityPnlReporter;
