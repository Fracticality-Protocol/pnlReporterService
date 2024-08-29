import { FractalityPnlReporter } from './pnlReporter';
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

_parseEnvVars();

const pnlReporter = new FractalityPnlReporter(
    GET_NAV_URL,
    API_KEY,
    VAULT_ADDRESS,
    PRIVATE_KEY,
    RPC_URL,
    TIME_PERIOD_FOR_CONTRACT_WRITE,
    PERCENTAGE_TRIGGER_CHANGE,
    FractalityV2VaultABI.abi,
);


async function main() {
    await pnlReporter.initialize();
}
main();


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