import { BigNumber } from '@ethersproject/bignumber';
import { TxStats } from '../stats/collector';

export enum RuntimeType {
    EOA = 'EOA',
    ERC20 = 'ERC20',
    ERC721 = 'ERC721',
    GREETER = 'GREETER',
}

export interface Runtime {
    // Estimates the base runtime transaction gas limit
    EstimateBaseTx(): Promise<BigNumber>;

    // Fetches the average gas price in the network
    GetGasPrice(): Promise<BigNumber>;

    // Returns the value of each cycle transaction, if any
    GetValue(): BigNumber;

    // Runs the stress-test cycle
    Run(accountIndexes: number[], numTxs: number): Promise<TxStats[]>;
}
