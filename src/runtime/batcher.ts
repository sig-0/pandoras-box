import axios from 'axios';
import { SingleBar } from 'cli-progress';
import Logger from '../logger/logger';

class Batcher {
    // Generates batches of items based on the passed in
    // input set
    static generateBatches<ItemType>(
        items: ItemType[],
        batchSize: number
    ): ItemType[][] {
        const batches: ItemType[][] = [];

        // Find the required number of batches
        let numBatches: number = Math.ceil(items.length / batchSize);
        if (numBatches == 0) {
            numBatches = 1;
        }

        // Initialize empty batches
        for (let i = 0; i < numBatches; i++) {
            batches[i] = [];
        }

        let currentBatch = 0;
        for (const item of items) {
            batches[currentBatch].push(item);

            if (batches[currentBatch].length % batchSize == 0) {
                currentBatch++;
            }
        }

        return batches;
    }

    static async batchTransactions(
        signedTxs: string[],
        batchSize: number,
        url: string
    ): Promise<string[]> {
        // Generate the transaction hash batches
        const batches: string[][] = Batcher.generateBatches<string>(
            signedTxs,
            batchSize
        );

        Logger.info('Sending transactions in batches...');

        const batchBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        batchBar.start(batches.length, 0, {
            speed: 'N/A',
        });

        const txHashes: string[] = [];
        const batchErrors: string[] = [];

        try {
            let nextIndx = 0;
            const responses = await Promise.all(
                batches.map((item) => {
                    let singleRequests = '';
                    for (let i = 0; i < item.length; i++) {
                        singleRequests += JSON.stringify({
                            jsonrpc: '2.0',
                            method: 'eth_sendRawTransaction',
                            params: [item[i]],
                            id: nextIndx++,
                        });

                        if (i != item.length - 1) {
                            singleRequests += ',\n';
                        }
                    }

                    batchBar.increment();

                    return axios({
                        url: url,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        data: '[' + singleRequests + ']',
                    });
                })
            );

            for (let i = 0; i < responses.length; i++) {
                const content = responses[i].data;

                for (const cnt of content) {
                    // eslint-disable-next-line no-prototype-builtins
                    if (cnt.hasOwnProperty('error')) {
                        // Error occurred during batch sends
                        batchErrors.push(cnt.error.message);

                        continue;
                    }

                    txHashes.push(cnt.result);
                }
            }
        } catch (e: any) {
            Logger.error(e.message);
        }

        batchBar.stop();

        if (batchErrors.length > 0) {
            Logger.warn('Errors encountered during batch sending:');

            for (const err of batchErrors) {
                Logger.error(err);
            }
        }

        Logger.success(
            `${batches.length} ${batches.length > 1 ? 'batches' : 'batch'} sent`
        );

        return txHashes;
    }
}

export default Batcher;
