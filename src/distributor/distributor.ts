import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import Heap from 'heap';

class distributeAccount {
    missingFunds: BigNumber;
    address: string;

    constructor(missingFunds: BigNumber, address: string) {
        this.missingFunds = missingFunds;
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

    async findAccountsForDistribution(
        singleDistributionCost: BigNumber
    ): Promise<Heap<distributeAccount>> {
        const shortAddresses = new Heap<distributeAccount>();

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
                    new distributeAccount(
                        singleDistributionCost.sub(balance),
                        addrWallet.address
                    )
                );
            }
        }

        return shortAddresses;
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

        // Check if there are any addresses that need funding
        const shortAddresses = await this.findAccountsForDistribution(
            singleDistributionCost
        );

        const initialFundAccounts = shortAddresses.size();

        if (initialFundAccounts == 0) {
            // TODO add chalk
            // Nothing to distribute
            console.log('Nothing to distribute!');

            return;
        }

        // Check if the root wallet has enough funds to distribute
        let accountsToFund: distributeAccount[] = [];
        let distributorBalance = BigNumber.from(
            await this.ethWallet.getBalance()
        );

        while (distributorBalance.gt(singleDistributionCost)) {
            const acc = shortAddresses.pop() as distributeAccount;
            distributorBalance = distributorBalance.sub(acc.missingFunds);

            accountsToFund.push(acc);
        }

        if (accountsToFund.length == 0) {
            throw new Error('unable to fund any account');
        }

        if (accountsToFund.length != initialFundAccounts) {
            // TODO chalk
            console.log(
                'Unable to fund all accounts, funding',
                accountsToFund.length
            );
        }

        // Fund the accounts
        for (const acc of accountsToFund) {
            await this.ethWallet.sendTransaction({
                to: acc.address,
                value: singleDistributionCost.sub(acc.missingFunds),
            });
        }

        console.log('Distribution finished!');
    }
}
