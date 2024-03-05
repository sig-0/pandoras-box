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

class StatCollector {
    async gatherTransactionReceipts(
        txHashes: string[],
        stats: txStats[],
        provider: Provider
    ): Promise<Map<number, BlockInfo>> {
        let isOk = await this.waitForTxPoolToEmpty((provider as JsonRpcProvider).connection.url, txHashes.length);
        if (!isOk) {
            return new Map<number, BlockInfo>();
        }

        Logger.info('\nGathering transaction receipts...');

        const receiptBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        receiptBar.start(txHashes.length, 0, {
            speed: 'N/A',
        });

        const fetchErrors: string[] = [];

        const blocksMap: Map<number, BlockInfo> = new Map<number, BlockInfo>();
        const txToBlockMap: Map<string, number> = new Map<string, number>();

        for (const txHash of txHashes) {
            try {
                if (txToBlockMap.has(txHash)) {
                    stats.push(new txStats(txHash, txToBlockMap.get(txHash) as number));
                    receiptBar.increment();

                    continue;
                }

                const txReceipt = await provider.waitForTransaction(
                    txHash,
                    1,
                    60 * 10000
                );

                if (txReceipt.status != undefined && txReceipt.status == 0) {
                    throw new Error(
                        `transaction ${txHash} failed during execution`
                    );
                }

                stats.push(new txStats(txHash, txReceipt.blockNumber));

                const block = await provider.getBlock(txReceipt.blockNumber);
                blocksMap.set(
                    block.number,
                    new BlockInfo(
                        block.number,
                        block.timestamp,
                        block.transactions.length,
                        block.gasUsed,
                        block.gasLimit
                    )
                );

                for (const tx of block.transactions) {
                    txToBlockMap.set(tx, block.number);
                }

            } catch (e: any) {
                fetchErrors.push(e);
            }

            receiptBar.increment();
        }

        receiptBar.stop();
        if (fetchErrors.length > 0) {
            Logger.warn('Errors encountered during batch sending:');

            for (const err of fetchErrors) {
                Logger.error(err);
            }
        }

        Logger.success('Gathered transaction receipts');

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
                    const currentBlock = await provider.getBlock(
                        currentBlockNum
                    );

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
        url: string,
    ): Promise<CollectorData> {
        if (txHashes.length == 0) {
            Logger.warn('No stat data to display');

            return new CollectorData(0, new Map());
        }

        let txStats: txStats[] = [];

        Logger.title('\n⏱ Statistics calculation initialized ⏱\n');

        const provider = new JsonRpcProvider(url);

        // Fetch receipts
        const blockInfoMap = await this.gatherTransactionReceipts(
            txHashes,
            txStats,
            provider
        );

        // Print the block utilization data
        this.printBlockData(blockInfoMap);

        // Print the final TPS and avg. utilization data
        const avgTPS = await this.calcTPS(txStats, provider);
        this.printFinalData(avgTPS, blockInfoMap);

        return new CollectorData(avgTPS, blockInfoMap);
    }

    async waitForTxPoolToEmpty(url: string, numOfTxs: number): Promise<boolean> {
        const timeout = numOfTxs * 500; // assume a transaction needs half a second
        let stopFlag = false;

        Logger.info('\nWaiting for all transactions to be executed...');

        let pending = 1;
        let queued = 1;
        const txpoolStatusPromise = async () => {
            while (!stopFlag) {
                try {
                    const response = await axios.post(url, {
                        jsonrpc: '2.0',
                        method: 'txpool_status',
                        params: [],
                        id: 1,
                    });
    
                    const { pending: newPending, queued: newQueued } = response.data.result;
                    pending = newPending;
                    queued = newQueued;
    
                    Logger.info(
                        `Pending: ${pending} | Queued: ${queued}`
                    );

                    if (pending === 0 && queued === 0) {
                        return true; // Break the loop if there are no pending or queued transactions
                    }
    
                } catch (error) {
                    console.error('Error checking txpool status:', error);
                }
    
                await new Promise(resolve => setTimeout(resolve, 2 * 1000)); // ping every 2 seconds
            }

            return true;
        };
        
        const timeoutPromise = new Promise<boolean>((_, reject) => {
            setTimeout(() => {
                stopFlag = true; // Stop the txpoolStatusPromise loop
                reject(new Error('Timeout: Waiting for tx pool to empty took longer than ' + timeout / 1000 + 'seconds.'));
            }, timeout);
        });

        try {
            await Promise.race([txpoolStatusPromise(), timeoutPromise]);

            return true;
        } catch (error: any) {
            Logger.error(error.message);

            return false;
        }
    }
}

export { StatCollector, CollectorData, BlockInfo };
