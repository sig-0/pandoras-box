import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import Heap from 'heap';

class distributeAccount {
    balance: BigNumber;
    address: string;

    constructor(balance: BigNumber, address: string) {
        this.balance = balance;
        this.address = address;
    }
}

interface BaseTxEstimator {
    EstimateBaseTx(): BigNumber;

    GetValue(): BigNumber;
}

// Manages the fund distribution before each run-cycle
class Distributor {
    ethWallet: Wallet;
    mnemonic: string;
    provider: Provider;

    baseTxEstimate: BigNumber;
    inherentValue: BigNumber;

    totalTx: number;
    requestedSubAccounts: number;

    constructor(
        mnemonic: string,
        subAccounts: number,
        totalTx: number,
        baseTxEstimator: BaseTxEstimator,
        url: string
    ) {
        this.requestedSubAccounts = subAccounts;
        this.inherentValue = baseTxEstimator.GetValue();
        this.totalTx = totalTx;
        this.baseTxEstimate = baseTxEstimator.EstimateBaseTx();
        this.mnemonic = mnemonic;

        this.provider = new JsonRpcProvider(url);
        this.ethWallet = Wallet.fromMnemonic(
            mnemonic,
            `m/44'/60'/0'/0/0`
        ).connect(this.provider);
    }

    // TODO return mnemonic indexes that are participants
    async distribute() {
        // Calculate the cost of a single cycle transaction (in native currency)
        const transactionCost = this.inherentValue.gt(0)
            ? this.inherentValue.add(this.baseTxEstimate)
            : this.baseTxEstimate;

        // Calculate how much each sub-account needs
        // to execute their part of the run cycle
        const subAccountCost = transactionCost.mul(
            this.totalTx / this.requestedSubAccounts
        );

        // Calculate the cost of the single distribution transaction
        const singleDistributionCost = await this.provider.estimateGas({
            to: Wallet.fromMnemonic(this.mnemonic, `m/44'/60'/0'/0/1`).address,
            value: subAccountCost,
        });

        // Calculate the total distribution cost
        let totalDistributionCost = BigNumber.from(0);
        const shortAddresses = new Heap();
        for (let i = 1; i <= this.requestedSubAccounts; i++) {
            // TODO add feedback
            const addrWallet = Wallet.fromMnemonic(
                this.mnemonic,
                `m/44'/60'/0'/0/${i}`
            ).connect(this.provider);

            const balance = await addrWallet.getBalance();

            if (balance.lt(singleDistributionCost)) {
                // Address doesn't have enough funds, make sure it's
                // on the list to get topped off
                shortAddresses.push(
                    new distributeAccount(balance, addrWallet.address)
                );

                totalDistributionCost = totalDistributionCost.add(
                    singleDistributionCost.sub(balance)
                );
            }
        }

        if (shortAddresses.size() == 0) {
            // TODO add chalk
            // Nothing to distribute
            console.log('Nothing to distribute!');

            return;
        }

        // Check if the root wallet has enough funds to distribute
        const distributorBalance = await this.ethWallet.getBalance();
        let accountsToFund: distributeAccount[] = [];

        if (distributorBalance.lt(totalDistributionCost)) {
            // TODO change
            console.log(
                'The distributor address doesnt have enough funds for all accounts'
            );

            let leftoverCash = BigNumber.from(distributorBalance);
            while (leftoverCash.gt(singleDistributionCost)) {
                const acc = shortAddresses.pop() as distributeAccount;
                leftoverCash = leftoverCash.sub(acc.balance);

                accountsToFund.push(acc);
            }

            if (accountsToFund.length == 0) {
                throw new Error('unable to fund any account');
            }
        } else {
            // The distributor can fund all accounts
            accountsToFund = shortAddresses.toArray() as distributeAccount[];
        }

        // Fund the accounts
        for (const acc of accountsToFund) {
            await this.ethWallet.sendTransaction({
                to: acc.address,
                // TODO make sure this is in wei
                value: singleDistributionCost.sub(acc.balance),
            });
        }

        console.log('Distribution finished!');
    }
}
