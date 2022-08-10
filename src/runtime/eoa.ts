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
    gasPrice: BigNumber = BigNumber.from(0);

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

        Logger.success('Gathered initial nonce data\n');

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
        const gasPrice = this.gasPrice;

        Logger.info(`Chain ID: ${chainID}`);
        Logger.info(`Gas price: ${gasPrice.toHexString()}`);

        Logger.info('\nSending transactions...');

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

        let totalSentTx = 0;
        const walletMap: Map<number, Wallet> = new Map<number, Wallet>();

        // Initialize the walletMap
        const walletsToInit: number =
            accountIndexes.length > numTx ? numTx : accountIndexes.length;

        for (let i = 0; i < walletsToInit; i++) {
            const walletIndx = accountIndexes[i];

            walletMap.set(
                walletIndx,
                Wallet.fromMnemonic(
                    this.mnemonic,
                    `m/44'/60'/0'/0/${walletIndx}`
                ).connect(this.provider)
            );
        }

        while (totalSentTx < numTx) {
            let senderIndex = totalSentTx % accountIndexes.length;
            let receiverIndex = (totalSentTx + 1) % accountIndexes.length;

            if (senderIndex == 0) {
                senderIndex = 1;
                receiverIndex = senderIndex + 1;
            }

            if (receiverIndex == 0) {
                receiverIndex += 1;
            }

            const wallet = walletMap.get(senderIndex) as Wallet;
            const recipient = walletMap.get(receiverIndex) as Wallet;

            try {
                const nonce = startingNonces.get(senderIndex) as number;

                const sendTime = Date.now();
                const txResp = await wallet.sendTransaction({
                    from: wallet.address,
                    chainId: chainID,
                    to: recipient.address,
                    gasPrice: gasPrice,
                    gasLimit: this.gasEstimation,
                    value: value,
                    nonce: nonce,
                });

                txStats.push(new TxStats(txResp.hash, sendTime));

                // Increase the nonce for the next iteration
                startingNonces.set(senderIndex, nonce + 1);
            } catch (e: any) {
                failedTxnErrors.push(e);
            }

            totalSentTx++;
            txnBar.increment();
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
        Logger.title('\n⚡️ EOA to EOA transfers started ️⚡️\n');

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
