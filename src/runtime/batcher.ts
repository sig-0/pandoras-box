import axios from 'axios';
import { SingleBar } from 'cli-progress';
import Logger from '../logger/logger';
import { TxStats } from '../stats/collector';

class Batcher {
    static async batchTransactions(
        signedTxs: string[],
        batchSize: number,
        url: string
    ): Promise<TxStats[]> {
        // Find how many batches need to be sent out
        const batches: string[][] = [];
        let numBatches: number = Math.ceil(signedTxs.length / batchSize);
        if (numBatches == 0) {
            numBatches = 1;
        }

        Logger.info('Sending transactions in batches...');

        const batchBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        batchBar.start(numBatches, 0, {
            speed: 'N/A',
        });

        const txStats: TxStats[] = [];
        const batchErrors: string[] = [];

        try {
            for (let i = 0; i < numBatches; i++) {
                batches[i] = [];
            }

            let leftoverTxns = signedTxs.length;
            let txnIndex = 0;

            let currentBatch = 0;
            while (leftoverTxns > 0) {
                batches[currentBatch].push(signedTxs[txnIndex++]);
                leftoverTxns -= 1;

                if (batches[currentBatch].length % batchSize == 0) {
                    currentBatch++;
                }
            }

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
                    if (cnt.hasOwnProperty('error')) {
                        // Error occurred during batch sends
                        batchErrors.push(cnt.error.message);

                        continue;
                    }

                    txStats.push(new TxStats(cnt.result));
                }
            }
        } catch (e: any) {
            Logger.error(e.message);
        }

        batchBar.stop();

        if (batchErrors.length > 0) {
            Logger.warn('Errors encountered during back sending:');

            for (const err of batchErrors) {
                Logger.error(err);
            }
        }

        Logger.success(
            `${numBatches} ${numBatches > 1 ? 'batches' : 'batch'} sent`
        );

        return txStats;
    }
}

export default Batcher;
