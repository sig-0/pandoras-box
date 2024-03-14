import { BigNumber } from '@ethersproject/bignumber';
import { Contract, ContractFactory } from '@ethersproject/contracts';
import {
    JsonRpcProvider,
    Provider,
    TransactionRequest,
} from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { SingleBar } from 'cli-progress';
import ZexCoin from '../contracts/ZexCoinERC20.json';
import Logger from '../logger/logger';
import RuntimeErrors from './errors';
import { senderAccount } from './signer';

class ERC20Runtime {
    mnemonic: string;
    url: string;
    provider: Provider;

    gasEstimation: BigNumber = BigNumber.from(0);
    gasPrice: BigNumber = BigNumber.from(0);

    defaultValue: BigNumber = BigNumber.from(0);
    defaultTransferValue = 1;

    totalSupply = 500000000000;
    coinName = 'Zex Coin';
    coinSymbol = 'ZEX';

    contract: Contract | undefined;

    baseDeployer: Wallet;

    constructor(mnemonic: string, url: string) {
        this.mnemonic = mnemonic;
        this.provider = new JsonRpcProvider(url);
        this.url = url;

        this.baseDeployer = Wallet.fromMnemonic(
            this.mnemonic,
            `m/44'/60'/0'/0/0`
        ).connect(this.provider);
    }

    async Initialize() {
        // Initialize it
        this.contract = await this.deployERC20();
    }

    async deployERC20(): Promise<Contract> {
        const contractFactory = new ContractFactory(
            ZexCoin.abi,
            ZexCoin.bytecode,
            this.baseDeployer
        );

        const contract = await contractFactory.deploy(
            this.totalSupply,
            this.coinName,
            this.coinSymbol
        );

        await contract.deployTransaction.wait();

        return contract;
    }

    async EstimateBaseTx(): Promise<BigNumber> {
        if (!this.contract) {
            throw RuntimeErrors.errRuntimeNotInitialized;
        }

        // Estimate a simple transfer transaction
        this.gasEstimation = await this.contract.estimateGas.transfer(
            Wallet.fromMnemonic(this.mnemonic, `m/44'/60'/0'/0/1`).address,
            this.defaultTransferValue
        );

        return this.gasEstimation;
    }

    GetTransferValue(): number {
        return this.defaultTransferValue;
    }

    async GetTokenBalance(address: string): Promise<number> {
        if (!this.contract) {
            throw RuntimeErrors.errRuntimeNotInitialized;
        }

        return await this.contract.balanceOf(address);
    }

    async GetSupplierBalance(): Promise<number> {
        return this.GetTokenBalance(this.baseDeployer.address);
    }

    async FundAccount(to: string, amount: number): Promise<void> {
        if (!this.contract) {
            throw RuntimeErrors.errRuntimeNotInitialized;
        }

        const tx = await this.contract.transfer(to, amount);

        // Wait for the transfer transaction to be mined
        await tx.wait();
    }

    GetTokenSymbol(): string {
        return this.coinSymbol;
    }

    GetValue(): BigNumber {
        return this.defaultValue;
    }

    async GetGasPrice(): Promise<BigNumber> {
        this.gasPrice = await this.provider.getGasPrice();

        return this.gasPrice;
    }

    async ConstructTransactions(
        accounts: senderAccount[],
        numTx: number
    ): Promise<TransactionRequest[]> {
        if (!this.contract) {
            throw RuntimeErrors.errRuntimeNotInitialized;
        }

        const chainID = await this.baseDeployer.getChainId();
        const gasPrice = this.gasPrice;

        Logger.info(`Chain ID: ${chainID}`);
        Logger.info(`Avg. gas price: ${gasPrice.toHexString()}`);

        const constructBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        Logger.info(`\nConstructing ${this.coinName} transfer transactions...`);
        constructBar.start(numTx, 0, {
            speed: 'N/A',
        });

        const transactions: TransactionRequest[] = [];
        const numAccounts = accounts.length;
        const txsPerAccount = Math.floor(numTx / numAccounts);
        const remainingTxs = numTx % numAccounts;

        for (let i = 0; i < numAccounts; i++) {
            const sender = accounts[i];
            const wallet = Wallet.fromMnemonic(
                this.mnemonic,
                `m/44'/60'/0'/0/${i}`
            ).connect(this.provider);

            for (let j = 0; j < txsPerAccount; j++) {
                const receiverIndex = (i + j + 1) % numAccounts;
                const receiver = accounts[receiverIndex];

                const transaction = await this.createTransferTransaction(wallet, receiver, sender, chainID, gasPrice);
                transactions.push(transaction);
    
                sender.incrNonce();
                constructBar.increment();
            }
        }

        const sender = accounts[accounts.length - 1];
        const wallet = Wallet.fromMnemonic(
            this.mnemonic,
            `m/44'/60'/0'/0/${accounts.length - 1}`
        ).connect(this.provider);

        const receiver = accounts[0];
        for (let i = 0; i < remainingTxs; i++) {
            const transaction = await this.createTransferTransaction(wallet, receiver, sender, chainID, gasPrice);
            transactions.push(transaction);

            sender.incrNonce();
            constructBar.increment();
        }

        constructBar.stop();
        Logger.success(`Successfully constructed ${numTx} transactions`);

        return transactions;
    }

    async createTransferTransaction(
        wallet: Wallet, 
        receiver: senderAccount, 
        sender: senderAccount, 
        chainID: number, 
        gasPrice: BigNumber) : Promise<TransactionRequest> {
        const contract = new Contract(
            this.contract?.address as string,
            ZexCoin.abi,
            wallet
        );

        const transaction = await contract.populateTransaction.transfer(
            receiver.getAddress(),
            this.defaultTransferValue
        );

        // Override the defaults
        transaction.from = sender.getAddress();
        transaction.chainId = chainID;
        transaction.gasPrice = BigNumber.from(gasPrice).mul(150).div(100);
        transaction.gasLimit = BigNumber.from(this.gasEstimation).mul(150).div(100);
        transaction.nonce = sender.getNonce();

        return transaction;
    }

    GetStartMessage(): string {
        return '\n⚡️ ERC20 token transfers initialized ️⚡️\n';
    }
}

export default ERC20Runtime;
