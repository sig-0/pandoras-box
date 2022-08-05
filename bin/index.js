#!/usr/bin/env node
'use strict';
var __awaiter =
    (this && this.__awaiter) ||
    function (thisArg, _arguments, P, generator) {
        function adopt(value) {
            return value instanceof P
                ? value
                : new P(function (resolve) {
                      resolve(value);
                  });
        }
        return new (P || (P = Promise))(function (resolve, reject) {
            function fulfilled(value) {
                try {
                    step(generator.next(value));
                } catch (e) {
                    reject(e);
                }
            }
            function rejected(value) {
                try {
                    step(generator['throw'](value));
                } catch (e) {
                    reject(e);
                }
            }
            function step(result) {
                result.done
                    ? resolve(result.value)
                    : adopt(result.value).then(fulfilled, rejected);
            }
            step(
                (generator = generator.apply(thisArg, _arguments || [])).next()
            );
        });
    };
Object.defineProperty(exports, '__esModule', { value: true });
const commander_1 = require('commander');
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const program = new commander_1.Command();
        program
            .argument('<url>', 'Lighthouse will run the analysis on the URL.')
            .option(
                '-i, --iteration <type>',
                'How many times Lighthouse should run the analysis per URL',
                '5'
            )
            .parse();
        const [url] = program.args;
        const options = program.opts();
        console.log(`url: ${url}, iteration: ${options.iteration}`);
    });
}
run();
