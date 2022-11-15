import {
    JsonRpcProvider,
    Provider,
    TransactionRequest,
} from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { SingleBar } from 'cli-progress';
import Logger from '../logger/logger';

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

class Signer {
    mnemonic: string;
    provider: Provider;

    constructor(mnemonic: string, url: string) {
        this.mnemonic = mnemonic;
        this.provider = new JsonRpcProvider(url);
    }

    async getSenderAccounts(
        accountIndexes: number[],
        numTxs: number
    ): Promise<senderAccount[]> {
        Logger.info('\nGathering initial account nonces...');

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

        const accounts: senderAccount[] = [];
        for (let i = 0; i < walletsToInit; i++) {
            const accIndex = accountIndexes[i];

            const wallet = Wallet.fromMnemonic(
                this.mnemonic,
                `m/44'/60'/0'/0/${accIndex}`
            ).connect(this.provider);
            const accountNonce = await wallet.getTransactionCount();

            accounts.push(new senderAccount(accIndex, accountNonce, wallet));

            nonceBar.increment();
        }

        nonceBar.stop();

        Logger.success('Gathered initial nonce data\n');

        return accounts;
    }

    async signTransactions(
        accounts: senderAccount[],
        transactions: TransactionRequest[]
    ): Promise<string[]> {
        const failedTxnSignErrors: Error[] = [];

        const signBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        Logger.info('\nSigning transactions...');
        signBar.start(transactions.length, 0, {
            speed: 'N/A',
        });

        const signedTxs: string[] = [];

        for (let i = 0; i < transactions.length; i++) {
            const sender = accounts[i % accounts.length];

            try {
                signedTxs.push(
                    await sender.wallet.signTransaction(transactions[i])
                );
            } catch (e: any) {
                failedTxnSignErrors.push(e);
            }

            signBar.increment();
        }

        signBar.stop();
        Logger.success(`Successfully signed ${signedTxs.length} transactions`);

        if (failedTxnSignErrors.length > 0) {
            Logger.warn('Errors encountered during transaction signing:');

            for (const err of failedTxnSignErrors) {
                Logger.error(err.message);
            }
        }

        return signedTxs;
    }
}

export { Signer, senderAccount };
