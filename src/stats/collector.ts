import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import axios, { AxiosResponse } from 'axios';
import { SingleBar } from 'cli-progress';
import Table from 'cli-table3';
import Logger from '../logger/logger';
import Batcher from '../runtime/batcher';

class txStats {
    txHash: string;
    block = 0;

    constructor(txHash: string, block: number) {
        this.txHash = txHash;
        this.block = block;
    }
}

class BlockInfo {
    blockNum: number;
    createdAt: number;
    numTxs: number;

    gasUsed: string;
    gasLimit: string;
    gasUtilization: number;

    constructor(
        blockNum: number,
        createdAt: number,
        numTxs: number,
        gasUsed: BigNumber,
        gasLimit: BigNumber
    ) {
        this.blockNum = blockNum;
        this.createdAt = createdAt;
        this.numTxs = numTxs;
        this.gasUsed = gasUsed.toHexString();
        this.gasLimit = gasLimit.toHexString();

        const largeDivision = gasUsed
            .mul(BigNumber.from(10000))
            .div(gasLimit)
            .toNumber();

        this.gasUtilization = largeDivision / 100;
    }
}

class CollectorData {
    tps: number;
    blockInfo: Map<number, BlockInfo>;

    constructor(tps: number, blockInfo: Map<number, BlockInfo>) {
        this.tps = tps;
        this.blockInfo = blockInfo;
    }
}

class txBatchResult {
    succeeded: txStats[];
    remaining: string[];

    errors: string[];

    constructor(succeeded: txStats[], remaining: string[], errors: string[]) {
        this.succeeded = succeeded;
        this.remaining = remaining;

        this.errors = errors;
    }
}

class StatCollector {
    async gatherTransactionReceipts(
        txHashes: string[],
        batchSize: number,
        provider: Provider
    ): Promise<txStats[]> {
        Logger.info('Gathering transaction receipts...');

        const receiptBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        receiptBar.start(txHashes.length, 0, {
            speed: 'N/A',
        });

        const fetchErrors: string[] = [];

        let receiptBarProgress = 0;
        let retryCounter = Math.ceil(txHashes.length * 0.025);
        let remainingTransactions: string[] = txHashes;
        let succeededTransactions: txStats[] = [];

        const providerURL = (provider as JsonRpcProvider).connection.url;

        // Fetch transaction receipts in batches,
        // until the batch retry counter is reached (to avoid spamming)
        while (remainingTransactions.length > 0) {
            // Get the receipts for this batch
            const result = await this.fetchTransactionReceipts(
                remainingTransactions,
                batchSize,
                providerURL
            );

            // Save any fetch errors
            for (const fetchErr of result.errors) {
                fetchErrors.push(fetchErr);
            }

            // Update the remaining transactions whose
            // receipts need to be fetched
            remainingTransactions = result.remaining;

            // Save the succeeded transactions
            succeededTransactions = succeededTransactions.concat(
                result.succeeded
            );

            // Update the user loading bar
            receiptBar.increment(
                succeededTransactions.length - receiptBarProgress
            );
            receiptBarProgress = succeededTransactions.length;

            // Decrease the retry counter
            retryCounter--;

            if (remainingTransactions.length == 0 || retryCounter == 0) {
                // If there are no more remaining transaction receipts to wait on,
                // or the batch retries have been depleted, stop the batching process
                break;
            }

            // Wait for a block to be mined on the network before asking
            // for the receipts again
            await new Promise((resolve) => {
                provider.once('block', () => {
                    resolve(null);
                });
            });
        }

        // Wait for the transaction receipts individually
        // if they were not retrieved in the batching process.
        // This process is slower, but it guarantees transaction receipts
        // will eventually get retrieved, regardless of the number of blocks
        for (const txHash of remainingTransactions) {
            const txReceipt = await provider.waitForTransaction(
                txHash,
                1,
                30 * 1000 // 30s per transaction
            );

            receiptBar.increment(1);

            if (txReceipt.status != undefined && txReceipt.status == 0) {
                throw new Error(
                    `transaction ${txReceipt.transactionHash} failed on execution`
                );
            }

            succeededTransactions.push(
                new txStats(txHash, txReceipt.blockNumber)
            );
        }

        receiptBar.stop();
        if (fetchErrors.length > 0) {
            Logger.warn('Errors encountered during batch sending:');

            for (const err of fetchErrors) {
                Logger.error(err);
            }
        }

        Logger.success('Gathered transaction receipts');

        return succeededTransactions;
    }

    async fetchTransactionReceipts(
        txHashes: string[],
        batchSize: number,
        url: string
    ): Promise<txBatchResult> {
        // Create the batches for transaction receipts
        const batches: string[][] = Batcher.generateBatches<string>(
            txHashes,
            batchSize
        );
        const succeeded: txStats[] = [];
        const remaining: string[] = [];
        const batchErrors: string[] = [];

        let nextIndx = 0;
        const responses = await Promise.all<AxiosResponse<any, any>>(
            batches.map((hashes) => {
                let singleRequests = '';
                for (let i = 0; i < hashes.length; i++) {
                    singleRequests += JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'eth_getTransactionReceipt',
                        params: [hashes[i]],
                        id: nextIndx++,
                    });

                    if (i != hashes.length - 1) {
                        singleRequests += ',\n';
                    }
                }

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

        for (let batchIndex = 0; batchIndex < responses.length; batchIndex++) {
            const data = responses[batchIndex].data;

            for (
                let txHashIndex = 0;
                txHashIndex < data.length;
                txHashIndex++
            ) {
                const batchItem = data[txHashIndex];

                if (!batchItem.result) {
                    remaining.push(batches[batchIndex][txHashIndex]);

                    continue;
                }

                // eslint-disable-next-line no-prototype-builtins
                if (batchItem.hasOwnProperty('error')) {
                    // Error occurred during batch sends
                    batchErrors.push(batchItem.error.message);

                    continue;
                }

                if (batchItem.result.status == '0x0') {
                    // Transaction failed
                    throw new Error(
                        `transaction ${batchItem.result.transactionHash} failed on execution`
                    );
                }

                succeeded.push(
                    new txStats(
                        batchItem.result.transactionHash,
                        batchItem.result.blockNumber
                    )
                );
            }
        }

        return new txBatchResult(succeeded, remaining, batchErrors);
    }

    async fetchBlockInfo(
        stats: txStats[],
        provider: Provider
    ): Promise<Map<number, BlockInfo>> {
        const blockSet: Set<number> = new Set<number>();
        for (const s of stats) {
            blockSet.add(s.block);
        }

        const blockFetchErrors: Error[] = [];

        Logger.info('\nGathering block info...');
        const blocksBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        blocksBar.start(blockSet.size, 0, {
            speed: 'N/A',
        });

        const blocksMap: Map<number, BlockInfo> = new Map<number, BlockInfo>();
        for (const block of blockSet.keys()) {
            try {
                const fetchedInfo = await provider.getBlock(block);

                blocksBar.increment();

                blocksMap.set(
                    block,
                    new BlockInfo(
                        block,
                        fetchedInfo.timestamp,
                        fetchedInfo.transactions.length,
                        fetchedInfo.gasUsed,
                        fetchedInfo.gasLimit
                    )
                );
            } catch (e: any) {
                blockFetchErrors.push(e);
            }
        }

        blocksBar.stop();

        Logger.success('Gathered block info');

        if (blockFetchErrors.length > 0) {
            Logger.warn('Errors encountered during block info fetch:');

            for (const err of blockFetchErrors) {
                Logger.error(err.message);
            }
        }

        return blocksMap;
    }

    async calcTPS(stats: txStats[], provider: Provider): Promise<number> {
        Logger.title('\n🧮 Calculating TPS data 🧮\n');
        let totalTxs = 0;
        let totalTime = 0;

        // Find the average txn time per block
        const blockFetchErrors = [];
        const blockTimeMap: Map<number, number> = new Map<number, number>();
        const uniqueBlocks = new Set<number>();

        for (const stat of stats) {
            if (stat.block == 0) {
                continue;
            }

            totalTxs++;
            uniqueBlocks.add(stat.block);
        }

        for (const block of uniqueBlocks) {
            // Get the parent block to find the generation time
            try {
                const currentBlockNum = block;
                const parentBlockNum = currentBlockNum - 1;

                if (!blockTimeMap.has(parentBlockNum)) {
                    const parentBlock = await provider.getBlock(parentBlockNum);

                    blockTimeMap.set(parentBlockNum, parentBlock.timestamp);
                }

                const parentBlock = blockTimeMap.get(parentBlockNum) as number;

                if (!blockTimeMap.has(currentBlockNum)) {
                    const currentBlock =
                        await provider.getBlock(currentBlockNum);

                    blockTimeMap.set(currentBlockNum, currentBlock.timestamp);
                }

                const currentBlock = blockTimeMap.get(
                    currentBlockNum
                ) as number;

                totalTime += Math.round(Math.abs(currentBlock - parentBlock));
            } catch (e: any) {
                blockFetchErrors.push(e);
            }
        }

        return Math.ceil(totalTxs / totalTime);
    }

    printBlockData(blockInfoMap: Map<number, BlockInfo>) {
        Logger.info('\nBlock utilization data:');
        const utilizationTable = new Table({
            head: [
                'Block #',
                'Gas Used [wei]',
                'Gas Limit [wei]',
                'Transactions',
                'Utilization',
            ],
        });

        const sortedMap = new Map(
            [...blockInfoMap.entries()].sort((a, b) => a[0] - b[0])
        );

        sortedMap.forEach((info) => {
            utilizationTable.push([
                info.blockNum,
                info.gasUsed,
                info.gasLimit,
                info.numTxs,
                `${info.gasUtilization}%`,
            ]);
        });

        Logger.info(utilizationTable.toString());
    }

    printFinalData(tps: number, blockInfoMap: Map<number, BlockInfo>) {
        // Find average utilization
        let totalUtilization = 0;
        blockInfoMap.forEach((info) => {
            totalUtilization += info.gasUtilization;
        });
        const avgUtilization = totalUtilization / blockInfoMap.size;

        const finalDataTable = new Table({
            head: ['TPS', 'Blocks', 'Avg. Utilization'],
        });

        finalDataTable.push([
            tps,
            blockInfoMap.size,
            `${avgUtilization.toFixed(2)}%`,
        ]);

        Logger.info(finalDataTable.toString());
    }

    async generateStats(
        txHashes: string[],
        mnemonic: string,
        url: string,
        batchSize: number
    ): Promise<CollectorData> {
        if (txHashes.length == 0) {
            Logger.warn('No stat data to display');

            return new CollectorData(0, new Map());
        }

        Logger.title('\n⏱ Statistics calculation initialized ⏱\n');

        const provider = new JsonRpcProvider(url);

        // Fetch receipts
        const txStats = await this.gatherTransactionReceipts(
            txHashes,
            batchSize,
            provider
        );

        // Fetch block info
        const blockInfoMap = await this.fetchBlockInfo(txStats, provider);

        // Print the block utilization data
        this.printBlockData(blockInfoMap);

        // Print the final TPS and avg. utilization data
        const avgTPS = await this.calcTPS(txStats, provider);
        this.printFinalData(avgTPS, blockInfoMap);

        return new CollectorData(avgTPS, blockInfoMap);
    }
}

export { StatCollector, CollectorData, BlockInfo };
