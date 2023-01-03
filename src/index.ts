#!/usr/bin/env node
import { Command } from 'commander';
import { Distributor, Runtime } from './distributor/distributor';
import TokenDistributor from './distributor/tokenDistributor';
import Logger from './logger/logger';
import Outputter from './outputter/outputter';
import { Engine, EngineContext } from './runtime/engine';
import EOARuntime from './runtime/eoa';
import ERC20Runtime from './runtime/erc20';
import ERC721Runtime from './runtime/erc721';
import RuntimeErrors from './runtime/errors';
import {
    InitializedRuntime,
    RuntimeType,
    TokenRuntime,
} from './runtime/runtimes';
import { StatCollector } from './stats/collector';

async function run() {
    const program = new Command();

    program
        .name('pandoras-box')
        .description(
            'A small and simple stress testing tool for Ethereum-compatible blockchain clients '
        )
        .version('1.0.0');

    program
        .requiredOption(
            '-url, --json-rpc <json-rpc-address>',
            'The URL of the JSON-RPC for the client'
        )
        .requiredOption(
            '-m, --mnemonic <mnemonic>',
            'The mnemonic used to generate spam accounts'
        )
        .option(
            '-s, -sub-accounts <sub-accounts>',
            'The number of sub-accounts that will send out transactions',
            '10'
        )
        .option(
            '-t, --transactions <transactions>',
            'The total number of transactions to be emitted',
            '2000'
        )
        .option(
            '--mode <mode>',
            'The mode for the stress test. Possible modes: [EOA, ERC20, ERC721]',
            'EOA'
        )
        .option(
            '-o, --output <output-path>',
            'The output path for the results JSON'
        )
        .option(
            '-b, --batch <batch>',
            'The batch size of JSON-RPC transactions',
            '20'
        )
        .parse();

    const options = program.opts();

    const url = options.jsonRpc;
    const transactionCount = options.transactions;
    const mode = options.mode;
    const mnemonic = options.mnemonic;
    const subAccountsCount = options.SubAccounts;
    const batchSize = options.batch;
    const output = options.output;

    let runtime: Runtime;
    switch (mode) {
        case RuntimeType.EOA:
            runtime = new EOARuntime(mnemonic, url);

            break;
        case RuntimeType.ERC20:
            runtime = new ERC20Runtime(mnemonic, url);

            // Initialize the runtime
            await (runtime as InitializedRuntime).Initialize();

            break;
        case RuntimeType.ERC721:
            runtime = new ERC721Runtime(mnemonic, url);

            // Initialize the runtime
            await (runtime as InitializedRuntime).Initialize();

            break;
        default:
            throw RuntimeErrors.errUnknownRuntime;
    }

    // Distribute the native currency funds
    const distributor = new Distributor(
        mnemonic,
        subAccountsCount,
        transactionCount,
        runtime,
        url
    );

    const accountIndexes: number[] = await distributor.distribute();

    // Distribute the token funds, if any
    if (mode === RuntimeType.ERC20) {
        const tokenDistributor = new TokenDistributor(
            mnemonic,
            accountIndexes,
            transactionCount,
            runtime as TokenRuntime
        );

        // Start the distribution
        await tokenDistributor.distributeTokens();
    }

    // Run the specific runtime
    const txHashes = await Engine.Run(
        runtime,
        new EngineContext(
            accountIndexes,
            transactionCount,
            batchSize,
            mnemonic,
            url
        )
    );

    // Collect the data
    const collectorData = await new StatCollector().generateStats(
        txHashes,
        mnemonic,
        url,
        batchSize
    );

    // Output the data if needed
    if (output) {
        Outputter.outputData(collectorData, output);
    }
}

run()
    .then()
    .catch((err) => {
        Logger.error(err);
    });
