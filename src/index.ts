#!/usr/bin/env node
import { Command } from 'commander';

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
            '-m, --mode <mode>',
            'The mode for the stress test. Possible modes: [EOA, ERC20, ERC721, GREETER]',
            'EOA'
        )
        .option(
            '-o, --output <output-path>',
            'The output path for the results JSON'
        )
        .parse();
}

run()
    .then()
    .catch((err) => {
        // TODO log errors with chalk
        console.error(err);
    });
