import { BigNumber } from '@ethersproject/bignumber';
import {
    JsonRpcProvider,
    Provider,
    TransactionRequest,
} from '@ethersproject/providers';
import { parseUnits } from '@ethersproject/units';
import { Wallet } from '@ethersproject/wallet';
import { SingleBar } from 'cli-progress';
import Logger from '../logger/logger';
import { senderAccount } from './signer';

class EOARuntime {
    mnemonic: string;
    url: string;
    provider: Provider;

    gasEstimation: BigNumber = BigNumber.from(0);
    gasPrice: BigNumber = BigNumber.from(0);

    // The default value for the E0A to E0A transfers
    // is 0.0001 native currency
    defaultValue: BigNumber = parseUnits('0.0001');

    constructor(mnemonic: string, url: string) {
        this.mnemonic = mnemonic;
        this.provider = new JsonRpcProvider(url);
        this.url = url;
    }

    async EstimateBaseTx(): Promise<BigNumber> {
        // EOA to EOA transfers are simple value transfers between accounts
        this.gasEstimation = await this.provider.estimateGas({
            from: Wallet.fromMnemonic(this.mnemonic, `m/44'/60'/0'/0/0`)
                .address,
            to: Wallet.fromMnemonic(this.mnemonic, `m/44'/60'/0'/0/1`).address,
            value: this.defaultValue,
        });

        return this.gasEstimation;
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
        const queryWallet = Wallet.fromMnemonic(
            this.mnemonic,
            `m/44'/60'/0'/0/0`
        ).connect(this.provider);

        const chainID = await queryWallet.getChainId();
        const gasPrice = this.gasPrice;

        Logger.info(`Chain ID: ${chainID}`);
        Logger.info(`Avg. gas price: ${gasPrice.toHexString()}`);

        const constructBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        Logger.info('\nConstructing value transfer transactions...');
        constructBar.start(numTx, 0, {
            speed: 'N/A',
        });

        const transactions: TransactionRequest[] = [];

        for (let i = 0; i < numTx; i++) {
            const senderIndex = i % accounts.length;
            const receiverIndex = (i + 1) % accounts.length;

            const sender = accounts[senderIndex];
            const receiver = accounts[receiverIndex];

            transactions.push({
                from: sender.getAddress(),
                chainId: chainID,
                to: receiver.getAddress(),
                gasPrice: gasPrice,
                gasLimit: this.gasEstimation,
                value: this.defaultValue,
                nonce: sender.getNonce(),
            });

            sender.incrNonce();
            constructBar.increment();
        }

        constructBar.stop();
        Logger.success(`Successfully constructed ${numTx} transactions`);

        return transactions;
    }

    GetStartMessage(): string {
        return '\n⚡️ EOA to EOA transfers initialized ️⚡️\n';
    }
}

export default EOARuntime;
