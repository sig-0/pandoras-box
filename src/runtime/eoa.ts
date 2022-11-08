import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { parseUnits } from '@ethersproject/units';
import { Wallet } from '@ethersproject/wallet';
import axios from 'axios';
import { SingleBar } from 'cli-progress';
import Logger from '../logger/logger';
import { TxStats } from '../stats/collector';

class senderAccount {
    mnemonicIndex: number;
    nonce: number;
    wallet: Wallet;

    constructor(mnemonicIndex: number, nonce: number, wallet: Wallet) {
        this.mnemonicIndex = mnemonicIndex;
        this.nonce = nonce;
        this.wallet = wallet;
    }

    incrNonce() {
        this.nonce++;
    }

    getNonce() {
        return this.nonce;
    }

    getAddress() {
        return this.wallet.address;
    }
}

class EOARuntime {
    mnemonic: string;
    url: string;
    provider: Provider;
    batchSize: number;

    gasEstimation: BigNumber = BigNumber.from(0);
    gasPrice: BigNumber = BigNumber.from(0);

    accounts: senderAccount[];

    constructor(mnemonic: string, url: string, batch: number) {
        this.mnemonic = mnemonic;
        this.provider = new JsonRpcProvider(url);
        this.url = url;
        this.batchSize = batch;

        this.accounts = [];
    }

    GetValue(): BigNumber {
        // The default value for the E0A to E0A transfers
        // is 0.0001 native currency
        return parseUnits('0.0001');
    }

    async EstimateBaseTx(): Promise<BigNumber> {
        // EOA to EOA transfers are simple value transfers between accounts
        this.gasEstimation = await this.provider.estimateGas({
            from: Wallet.fromMnemonic(this.mnemonic, `m/44'/60'/0'/0/0`)
                .address,
            to: Wallet.fromMnemonic(this.mnemonic, `m/44'/60'/0'/0/1`).address,
            value: this.GetValue(),
        });

        return this.gasEstimation;
    }

    async GetGasPrice(): Promise<BigNumber> {
        this.gasPrice = await this.provider.getGasPrice();

        return this.gasPrice;
    }

    async initializeSenderAccounts(accountIndexes: number[], numTxs: number) {
        Logger.info('Gathering initial account nonces...');

        // Maps the account index -> starting nonce
        const walletsToInit: number =
            accountIndexes.length > numTxs ? numTxs : accountIndexes.length;

        const nonceBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        nonceBar.start(walletsToInit, 0, {
            speed: 'N/A',
        });

        for (let i = 0; i < walletsToInit; i++) {
            const accIndex = accountIndexes[i];

            const wallet = Wallet.fromMnemonic(
                this.mnemonic,
                `m/44'/60'/0'/0/${accIndex}`
            ).connect(this.provider);
            const accountNonce = await wallet.getTransactionCount();

            this.accounts.push(
                new senderAccount(accIndex, accountNonce, wallet)
            );

            nonceBar.increment();
        }

        nonceBar.stop();

        Logger.success('Gathered initial nonce data\n');
    }

    async getNonceData(accountIndexes: number[]): Promise<Map<number, number>> {
        Logger.info('Gathering initial account nonces...');

        // Maps the account index -> starting nonce
        const startingNonces: Map<number, number> = new Map<number, number>();
        const nonceBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        nonceBar.start(accountIndexes.length, 0, {
            speed: 'N/A',
        });

        for (const accIndex of accountIndexes) {
            const wallet = Wallet.fromMnemonic(
                this.mnemonic,
                `m/44'/60'/0'/0/${accIndex}`
            ).connect(this.provider);

            startingNonces.set(accIndex, await wallet.getTransactionCount());
            nonceBar.increment();
        }

        nonceBar.stop();

        Logger.success('Gathered initial nonce data\n');

        return startingNonces;
    }

    async batchTransactions(
        numTxs: number,
        signedTxs: string[]
    ): Promise<TxStats[]> {
        // Find how many batches need to be sent out
        const batches: string[][] = [];
        let numBatches: number = Math.ceil(numTxs / this.batchSize);
        if (numBatches == 0) {
            numBatches = 1;
        }

        Logger.info('\nSending transactions in batches...');

        const batchBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        batchBar.start(numBatches, 0, {
            speed: 'N/A',
        });

        const txStats: TxStats[] = [];
        const batchErrors: string[] = [];

        try {
            for (let i = 0; i < numBatches; i++) {
                batches[i] = [];
            }

            let leftoverTxns = signedTxs.length;
            let txnIndex = 0;

            let currentBatch = 0;
            while (leftoverTxns > 0) {
                batches[currentBatch].push(signedTxs[txnIndex++]);
                leftoverTxns -= 1;

                if (batches[currentBatch].length % this.batchSize == 0) {
                    currentBatch++;
                }
            }

            let nextIndx = 0;
            const responses = await Promise.all(
                batches.map((item) => {
                    let singleRequests = '';
                    for (let i = 0; i < item.length; i++) {
                        singleRequests += JSON.stringify({
                            jsonrpc: '2.0',
                            method: 'eth_sendRawTransaction',
                            params: [item[i]],
                            id: nextIndx++,
                        });

                        if (i != item.length - 1) {
                            singleRequests += ',\n';
                        }
                    }

                    batchBar.increment();

                    return axios({
                        url: this.url,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        data: '[' + singleRequests + ']',
                    });
                })
            );

            for (let i = 0; i < responses.length; i++) {
                const content = responses[i].data;

                for (const cnt of content) {
                    if (cnt.hasOwnProperty('error')) {
                        // Error occurred during batch sends
                        batchErrors.push(cnt.error.message);

                        continue;
                    }

                    txStats.push(new TxStats(cnt.result));
                }
            }
        } catch (e: any) {
            Logger.error(e.message);
        }

        batchBar.stop();

        if (batchErrors.length > 0) {
            Logger.warn('Errors encountered during back sending:');

            for (const err of batchErrors) {
                Logger.error(err);
            }
        }

        Logger.success(
            `${numBatches} ${numBatches > 1 ? 'batches' : 'batch'} sent`
        );

        return txStats;
    }

    async sendTransactions(numTx: number): Promise<TxStats[]> {
        const queryWallet = Wallet.fromMnemonic(
            this.mnemonic,
            `m/44'/60'/0'/0/0`
        ).connect(this.provider);

        const chainID = await queryWallet.getChainId();
        const gasPrice = this.gasPrice;

        Logger.info(`Chain ID: ${chainID}`);
        Logger.info(`Avg. gas price: ${gasPrice.toHexString()}`);

        const value = this.GetValue();
        const failedTxnErrors: Error[] = [];

        let totalSentTx = 0;

        const signBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        Logger.info('\nSigning transactions...');
        signBar.start(numTx, 0, {
            speed: 'N/A',
        });

        const signedTxs: string[] = [];
        while (totalSentTx < numTx) {
            const senderIndex = totalSentTx % this.accounts.length;
            const receiverIndex = (totalSentTx + 1) % this.accounts.length;

            const sender = this.accounts[senderIndex];
            const receiver = this.accounts[receiverIndex];

            try {
                signedTxs.push(
                    await sender.wallet.signTransaction({
                        from: sender.getAddress(),
                        chainId: chainID,
                        to: receiver.getAddress(),
                        gasPrice: gasPrice,
                        gasLimit: this.gasEstimation,
                        value: value,
                        nonce: sender.getNonce(),
                    })
                );

                // Increase the nonce for the next iteration
                sender.incrNonce();
            } catch (e: any) {
                failedTxnErrors.push(e);
            }

            totalSentTx++;
            signBar.increment();
        }

        signBar.stop();

        if (failedTxnErrors.length > 0) {
            Logger.warn('Errors encountered during transaction signing:');

            for (const err of failedTxnErrors) {
                Logger.error(err.message);
            }
        }

        return this.batchTransactions(numTx, signedTxs);
    }

    async Run(accountIndexes: number[], numTxs: number): Promise<TxStats[]> {
        Logger.title('\n⚡️ EOA to EOA transfers initialized ️⚡️\n');

        // Initialize initial account data
        await this.initializeSenderAccounts(accountIndexes, numTxs);

        // Send the transactions
        return await this.sendTransactions(numTxs);
    }
}

export default EOARuntime;
