import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { SingleBar } from 'cli-progress';
import Table from 'cli-table';
import Heap from 'heap';
import Logger from '../logger/logger';
import DistributorErrors from './errors';

class distributeAccount {
    missingFunds: BigNumber;
    address: string;
    mnemonicIndex: number;

    constructor(missingFunds: BigNumber, address: string, index: number) {
        this.missingFunds = missingFunds;
        this.address = address;
        this.mnemonicIndex = index;
    }
}

class runtimeCosts {
    singleTx: BigNumber;
    accDistributionCost: BigNumber;
    subAccount: BigNumber;

    constructor(
        singleTx: BigNumber,
        accDistributionCost: BigNumber,
        subAccount: BigNumber
    ) {
        this.singleTx = singleTx;
        this.accDistributionCost = accDistributionCost;
        this.subAccount = subAccount;
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
    readyMnemonicIndexes: number[];

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
        this.readyMnemonicIndexes = [];

        this.provider = new JsonRpcProvider(url);
        this.ethWallet = Wallet.fromMnemonic(
            mnemonic,
            `m/44'/60'/0'/0/0`
        ).connect(this.provider);
    }

    async distribute(): Promise<number[]> {
        Logger.title('💸 Fund distribution initialized 💸');

        const baseCosts = await this.calculateRuntimeCosts();
        this.printCostTable(baseCosts);

        // Check if there are any addresses that need funding
        const shortAddresses = await this.findAccountsForDistribution(
            baseCosts.accDistributionCost
        );

        const initialAccCount = shortAddresses.size();

        if (initialAccCount == 0) {
            // Nothing to distribute
            Logger.success('Accounts are fully funded for the cycle');

            return this.readyMnemonicIndexes;
        }

        // Get a list of accounts that can be funded
        let fundableAccounts = await this.getFundableAccounts(
            baseCosts,
            shortAddresses
        );

        if (fundableAccounts.length != initialAccCount) {
            Logger.warn(
                `Unable to fund all sub-accounts. Funding ${fundableAccounts.length}`
            );
        }

        // Fund the accounts
        await this.fundAccounts(baseCosts, fundableAccounts);

        Logger.success('Fund distribution finished!');

        return this.readyMnemonicIndexes;
    }

    async calculateRuntimeCosts(): Promise<runtimeCosts> {
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

        return new runtimeCosts(
            transactionCost,
            singleDistributionCost,
            subAccountCost
        );
    }

    async findAccountsForDistribution(
        singleDistributionCost: BigNumber
    ): Promise<Heap<distributeAccount>> {
        const balanceBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        Logger.info('Fetching sub-account balances...');

        const shortAddresses = new Heap<distributeAccount>();

        for (let i = 1; i <= this.requestedSubAccounts; i++) {
            const addrWallet = Wallet.fromMnemonic(
                this.mnemonic,
                `m/44'/60'/0'/0/${i}`
            ).connect(this.provider);

            const balance = await addrWallet.getBalance();
            balanceBar.increment();

            if (balance.lt(singleDistributionCost)) {
                // Address doesn't have enough funds, make sure it's
                // on the list to get topped off
                shortAddresses.push(
                    new distributeAccount(
                        singleDistributionCost.sub(balance),
                        addrWallet.address,
                        i
                    )
                );

                continue;
            }

            // Address has enough funds already, mark it as ready
            this.readyMnemonicIndexes.push(i);
        }

        balanceBar.stop();

        return shortAddresses;
    }

    printCostTable(costs: runtimeCosts) {
        Logger.info('Cycle Cost Table:');
        const costTable = new Table({
            head: ['Name', 'Cost [wei]'],
        });

        costTable.push(
            ['Single tx cost', costs.singleTx.toHexString()],
            ['Distribution cost', costs.accDistributionCost.toHexString()],
            ['Account cost', costs.subAccount.toHexString()]
        );

        Logger.info(costTable.toString());
    }

    async getFundableAccounts(
        costs: runtimeCosts,
        initialSet: Heap<distributeAccount>
    ): Promise<distributeAccount[]> {
        // Check if the root wallet has enough funds to distribute
        let accountsToFund: distributeAccount[] = [];
        let distributorBalance = BigNumber.from(
            await this.ethWallet.getBalance()
        );

        while (distributorBalance.gt(costs.accDistributionCost)) {
            const acc = initialSet.pop() as distributeAccount;
            distributorBalance = distributorBalance.sub(acc.missingFunds);

            accountsToFund.push(acc);
        }

        // Check if there are accounts to fund
        if (accountsToFund.length == 0) {
            throw DistributorErrors.errNotEnoughFunds;
        }

        return accountsToFund;
    }

    async fundAccounts(costs: runtimeCosts, accounts: distributeAccount[]) {
        const fundBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        fundBar.start(accounts.length, 0, {
            speed: 'N/A',
        });

        for (const acc of accounts) {
            await this.ethWallet.sendTransaction({
                to: acc.address,
                value: costs.accDistributionCost.sub(acc.missingFunds),
            });

            fundBar.increment();
            this.readyMnemonicIndexes.push(acc.mnemonicIndex);
        }

        fundBar.stop();
    }
}
