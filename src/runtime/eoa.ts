import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { parseUnits } from '@ethersproject/units';
import { Wallet } from '@ethersproject/wallet';
import { SingleBar } from 'cli-progress';
import Logger from '../logger/logger';
import { TxStats } from '../stats/collector';

class EOARuntime {
    mnemonic: string;
    provider: Provider;

    gasEstimation: BigNumber = BigNumber.from(0);

    constructor(mnemonic: string, url: string) {
        this.mnemonic = mnemonic;
        this.provider = new JsonRpcProvider(url);
    }

    GetValue(): BigNumber {
        // The default value for the E0A to E0A transfers
        // is 0.0001 native currency
        return parseUnits('0.0001');
    }

    async EstimateBaseTx(): Promise<BigNumber> {
        // EOA to EOA transfers are simple value transfers between accounts
        this.gasEstimation = await this.provider.estimateGas({
            from: Wallet.fromMnemonic(this.mnemonic, `m/44'/60'/0'/0/1`)
                .address,
            to: Wallet.fromMnemonic(this.mnemonic, `m/44'/60'/0'/0/2`).address,
            value: this.GetValue(),
        });

        return this.gasEstimation;
    }

    async getNonceData(accountIndexes: number[]): Promise<Map<number, number>> {
        Logger.info('Gathering account nonces...');

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

        for (let accIndex of accountIndexes) {
            const wallet = Wallet.fromMnemonic(
                this.mnemonic,
                `m/44'/60'/0'/0/${accIndex}`
            ).connect(this.provider);

            startingNonces.set(accIndex, await wallet.getTransactionCount());
            nonceBar.increment();
        }

        nonceBar.stop();

        Logger.success('Gathered initial nonce data');

        return startingNonces;
    }

    async sendTransactions(
        accountIndexes: number[],
        numTx: number,
        startingNonces: Map<number, number>
    ): Promise<TxStats[]> {
        const queryWallet = Wallet.fromMnemonic(
            this.mnemonic,
            `m/44'/60'/0'/0/0`
        ).connect(this.provider);

        const chainID = await queryWallet.getChainId();
        const gasPrice = await queryWallet.getGasPrice();

        Logger.info(`Chain ID: ${chainID}`);
        Logger.info(`Gas price: ${gasPrice.toHexString()}`);

        // Calculate how many transactions each account needs to send
        const txsPerAccount = numTx / accountIndexes.length;

        Logger.info('Sending transactions...');

        const value = this.GetValue();
        const txStats: TxStats[] = [];

        const txnBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        txnBar.start(numTx, 0, {
            speed: 'N/A',
        });

        // Send out the transactions
        let failedTxnErrors: Error[] = [];

        for (let accIndex of accountIndexes) {
            const wallet = Wallet.fromMnemonic(
                this.mnemonic,
                `m/44'/60'/0'/0/${accIndex}`
            ).connect(this.provider);

            let transactionsSent = 0;

            // Send the transactions in Round Robbin fashion
            while (transactionsSent < txsPerAccount) {
                for (let innerIndex of accountIndexes) {
                    if (innerIndex == accIndex) {
                        continue;
                    }

                    const recipient = Wallet.fromMnemonic(
                        this.mnemonic,
                        `m/44'/60'/0'/0/${innerIndex}`
                    );

                    try {
                        const nonce = startingNonces.get(accIndex) as number;

                        // Send out the transaction
                        const txResp = await wallet.sendTransaction({
                            chainId: chainID,
                            to: recipient.address,
                            gasPrice: gasPrice,
                            gasLimit: this.gasEstimation,
                            value: value,
                            nonce: nonce,
                        });

                        txStats.push(
                            new TxStats(txResp.hash, new Date().getTime())
                        );

                        // Increase the nonce for the next iteration
                        startingNonces.set(accIndex, nonce + 1);
                    } catch (e: any) {
                        failedTxnErrors.push(e);
                    }

                    transactionsSent++;
                    txnBar.increment();

                    if (transactionsSent == txsPerAccount) {
                        break;
                    }
                }
            }
        }

        txnBar.stop();

        Logger.success(`${txStats.length} transactions sent`);

        if (failedTxnErrors.length > 0) {
            Logger.warn('Errors encountered during sending:');

            for (let err of failedTxnErrors) {
                Logger.error(err.message);
            }
        }

        return txStats;
    }

    async run(accountIndexes: number[], numTx: number): Promise<TxStats[]> {
        Logger.title('⚡️ EOA to EOA transfers started ️⚡️');

        // Gather starting nonces
        const startingNonces = await this.getNonceData(accountIndexes);

        // Send the transactions
        return await this.sendTransactions(
            accountIndexes,
            numTx,
            startingNonces
        );
    }
}

export default EOARuntime;
