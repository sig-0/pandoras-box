import { BigNumber } from '@ethersproject/bignumber';
import { TransactionRequest } from '@ethersproject/providers';
import { senderAccount } from './signer';

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

    // Constructs the specific runtime transactions
    ConstructTransactions(
        accounts: senderAccount[],
        numTxs: number
    ): Promise<TransactionRequest[]>;

    // Returns the start message for the user output
    GetStartMessage(): string;
}

export interface InitializedRuntime extends Runtime {
    // Initializes the runtime
    Initialize(): Promise<void>;
}

export interface TokenRuntime extends Runtime, InitializedRuntime {
    // Returns the transfer token value
    GetTransferValue(): number;

    // Returns the token balance for the specified address
    GetTokenBalance(address: string): Promise<number>;

    // Returns the suppliers token balance
    GetSupplierBalance(): Promise<number>;

    // Returns the token name
    GetTokenSymbol(): string;

    // Funds the specified account
    FundAccount(address: string, amount: number): Promise<void>;
}

export interface NFTRuntime extends Runtime, InitializedRuntime {}
