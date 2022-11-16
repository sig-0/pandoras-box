import { BigNumber } from '@ethersproject/bignumber';
import { Contract, ContractFactory } from '@ethersproject/contracts';
import {
    JsonRpcProvider,
    Provider,
    TransactionRequest,
} from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { SingleBar } from 'cli-progress';
import ZexNFTs from '../contracts/ZexNFTs.json';
import Logger from '../logger/logger';
import RuntimeErrors from './errors';
import { senderAccount } from './signer';

class ERC721Runtime {
    mnemonic: string;
    url: string;
    provider: Provider;

    gasEstimation: BigNumber = BigNumber.from(0);
    gasPrice: BigNumber = BigNumber.from(0);

    defaultValue: BigNumber = BigNumber.from(0);

    nftName = 'ZEXTokens';
    nftSymbol = 'ZEXes';
    nftURL = 'https://really-valuable-nft-page.io';

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
        this.contract = await this.deployERC721();
    }

    async deployERC721(): Promise<Contract> {
        const contractFactory = new ContractFactory(
            ZexNFTs.abi,
            ZexNFTs.bytecode,
            this.baseDeployer
        );

        const contract = await contractFactory.deploy(
            this.nftName,
            this.nftSymbol
        );

        await contract.deployTransaction.wait();

        return contract;
    }

    async EstimateBaseTx(): Promise<BigNumber> {
        if (!this.contract) {
            throw RuntimeErrors.errRuntimeNotInitialized;
        }

        // Estimate a simple transfer transaction
        this.gasEstimation = await this.contract.estimateGas.createNFT(
            this.nftURL
        );

        return this.gasEstimation;
    }

    GetNFTSymbol(): string {
        return this.nftSymbol;
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

        Logger.info(`\nConstructing ${this.nftName} mint transactions...`);
        constructBar.start(numTx, 0, {
            speed: 'N/A',
        });

        const transactions: TransactionRequest[] = [];

        for (let i = 0; i < numTx; i++) {
            const senderIndex = i % accounts.length;
            const sender = accounts[senderIndex];

            const wallet = Wallet.fromMnemonic(
                this.mnemonic,
                `m/44'/60'/0'/0/${senderIndex}`
            ).connect(this.provider);

            const contract = new Contract(
                this.contract.address,
                ZexNFTs.abi,
                wallet
            );

            const transaction = await contract.populateTransaction.createNFT(
                this.nftURL
            );

            // Override the defaults
            transaction.from = sender.getAddress();
            transaction.chainId = chainID;
            transaction.gasPrice = gasPrice;
            transaction.gasLimit = this.gasEstimation;
            transaction.nonce = sender.getNonce();

            transactions.push(transaction);

            sender.incrNonce();
            constructBar.increment();
        }

        constructBar.stop();
        Logger.success(`Successfully constructed ${numTx} transactions`);

        return transactions;
    }

    GetStartMessage(): string {
        return '\n⚡️ ERC721 NFT mints initialized ️⚡️\n';
    }
}

export default ERC721Runtime;
