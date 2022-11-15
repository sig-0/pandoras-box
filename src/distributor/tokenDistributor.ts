import { BigNumber } from '@ethersproject/bignumber';
import { Wallet } from '@ethersproject/wallet';
import { SingleBar } from 'cli-progress';
import Table from 'cli-table3';
import Heap from 'heap';
import Logger from '../logger/logger';
import { TokenRuntime } from '../runtime/runtimes';
import { distributeAccount } from './distributor';
import DistributorErrors from './errors';

class tokenRuntimeCosts {
    totalCost: number;
    subAccount: number;

    constructor(totalCost: number, subAccount: number) {
        this.totalCost = totalCost;
        this.subAccount = subAccount;
    }
}

class TokenDistributor {
    mnemonic: string;

    tokenRuntime: TokenRuntime;

    totalTx: number;
    readyMnemonicIndexes: number[];

    constructor(
        mnemonic: string,
        readyMnemonicIndexes: number[],
        totalTx: number,
        tokenRuntime: TokenRuntime
    ) {
        this.totalTx = totalTx;
        this.mnemonic = mnemonic;
        this.tokenRuntime = tokenRuntime;
        this.readyMnemonicIndexes = readyMnemonicIndexes;
    }

    async distributeTokens(): Promise<number[]> {
        Logger.title('\n🪙 Token distribution initialized 🪙');

        const baseCosts = await this.calculateRuntimeCosts();
        this.printCostTable(baseCosts);

        // Check if there are any addresses that need funding
        const shortAddresses = await this.findAccountsForDistribution(
            baseCosts.subAccount
        );

        const initialAccCount = shortAddresses.size();

        if (initialAccCount == 0) {
            // Nothing to distribute
            Logger.success(
                'Accounts are fully funded with tokens for the cycle'
            );

            return this.readyMnemonicIndexes;
        }

        // Get a list of accounts that can be funded
        const fundableAccounts = await this.getFundableAccounts(
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

    async calculateRuntimeCosts(): Promise<tokenRuntimeCosts> {
        const transferValue = this.tokenRuntime.GetTransferValue();

        const totalCost = transferValue * this.totalTx;
        const subAccountCost = Math.ceil(
            totalCost / this.readyMnemonicIndexes.length
        );

        return new tokenRuntimeCosts(totalCost, subAccountCost);
    }

    async findAccountsForDistribution(
        singleRunCost: number
    ): Promise<Heap<distributeAccount>> {
        const balanceBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        Logger.info('\nFetching sub-account token balances...');

        const shortAddresses = new Heap<distributeAccount>();

        balanceBar.start(this.readyMnemonicIndexes.length, 0, {
            speed: 'N/A',
        });

        for (const index of this.readyMnemonicIndexes) {
            const addrWallet = Wallet.fromMnemonic(
                this.mnemonic,
                `m/44'/60'/0'/0/${index}`
            );

            const balance: number = await this.tokenRuntime.GetTokenBalance(
                addrWallet.address
            );
            balanceBar.increment();

            if (balance < singleRunCost) {
                // Address doesn't have enough funds, make sure it's
                // on the list to get topped off
                shortAddresses.push(
                    new distributeAccount(
                        BigNumber.from(singleRunCost - balance),
                        addrWallet.address,
                        index
                    )
                );
            }
        }

        balanceBar.stop();
        Logger.success('Fetched initial token balances');

        return shortAddresses;
    }

    printCostTable(costs: tokenRuntimeCosts) {
        Logger.info('\nCycle Token Cost Table:');
        const costTable = new Table({
            head: ['Name', `Cost [${this.tokenRuntime.GetTokenSymbol()}]`],
        });

        costTable.push(
            ['Required acc. token balance', costs.subAccount],
            ['Total token distribution cost', costs.totalCost]
        );

        Logger.info(costTable.toString());
    }

    async fundAccounts(
        costs: tokenRuntimeCosts,
        accounts: distributeAccount[]
    ) {
        Logger.info('\nFunding accounts with tokens...');

        // Clear the list of ready indexes
        this.readyMnemonicIndexes = [];

        const fundBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        fundBar.start(accounts.length, 0, {
            speed: 'N/A',
        });

        for (const acc of accounts) {
            await this.tokenRuntime.FundAccount(
                acc.address,
                acc.missingFunds.toNumber()
            );

            fundBar.increment();
            this.readyMnemonicIndexes.push(acc.mnemonicIndex);
        }

        fundBar.stop();
    }

    async getFundableAccounts(
        costs: tokenRuntimeCosts,
        initialSet: Heap<distributeAccount>
    ): Promise<distributeAccount[]> {
        // Check if the root wallet has enough token funds to distribute
        const accountsToFund: distributeAccount[] = [];
        let distributorBalance = await this.tokenRuntime.GetSupplierBalance();

        while (distributorBalance > costs.subAccount && initialSet.size() > 0) {
            const acc = initialSet.pop() as distributeAccount;
            distributorBalance -= acc.missingFunds.toNumber();

            accountsToFund.push(acc);
        }

        // Check if the distributor has funds at all
        if (accountsToFund.length == 0) {
            throw DistributorErrors.errNotEnoughFunds;
        }

        return accountsToFund;
    }
}

export default TokenDistributor;
