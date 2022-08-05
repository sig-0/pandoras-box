#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const program = new commander_1.Command();
        program
            .name('pandoras-box')
            .description('A small and simple stress testing tool for Ethereum-compatible blockchain clients ')
            .version('1.0.0');
        program
            .requiredOption('-url, --json-rpc <json-rpc-address>', 'The URL of the JSON-RPC for the client')
            .requiredOption('-m, --mnemonic <mnemonic>', 'The mnemonic used to generate spam accounts')
            .option('-s, -sub-accounts <sub-accounts>', 'The number of sub-accounts that will send out transactions', '10')
            .option('-t, --transactions <transactions>', 'The total number of transactions to be emitted', '2000')
            .option('-m, --mode <mode>', 'The mode for the stress test. Possible modes: [EOA, ERC20, ERC721, GREETER]', 'EOA')
            .option('-o, --output <output-path>', 'The output path for the results JSON')
            .parse();
        // const options = program.opts();
    });
}
run()
    .then()
    .catch((err) => {
    // TODO log errors with chalk
    console.error(err);
});
