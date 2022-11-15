import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { SingleBar } from 'cli-progress';
import Table from 'cli-table3';
import Logger from '../logger/logger';

class TxStats {
    txHash: string;
    block = 0;

    constructor(txHash: string) {
        this.txHash = txHash;
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
    async fetchTransactionReceipts(stats: TxStats[], provider: Provider) {
        const txFetchErrors: Error[] = [];

        Logger.info('Gathering transaction receipts...');
        const receiptBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        receiptBar.start(stats.length, 0, {
            speed: 'N/A',
        });

        // Wait for all the transactions to get mined
        for (const txStat of stats) {
            try {
                const txReceipt = await provider.waitForTransaction(
                    txStat.txHash,
                    1,
                    60 * 10000
                );

                if (txReceipt.status != undefined && txReceipt.status == 0) {
                    throw new Error(
                        `transaction ${txStat.txHash} failed during execution`
                    );
                }

                txStat.block = txReceipt.blockNumber;
            } catch (e: any) {
                txFetchErrors.push(e);
            }

            receiptBar.increment();
        }

        receiptBar.stop();
        Logger.success('Gathered transaction receipts');

        if (txFetchErrors.length > 0) {
            Logger.warn('Errors encountered during receipts fetch:');

            for (const err of txFetchErrors) {
                Logger.error(err.message);
            }
        }
    }

    async fetchBlockInfo(
        stats: TxStats[],
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

    async calcTPS(stats: TxStats[], provider: Provider): Promise<number> {
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
        stats: TxStats[],
        mnemonic: string,
        url: string
    ): Promise<CollectorData> {
        if (stats.length == 0) {
            Logger.warn('No stat data to display');

            return new CollectorData(0, new Map());
        }

        Logger.title('\n⏱ Statistics calculation initialized ⏱\n');

        const provider = new JsonRpcProvider(url);

        // Fetch receipts
        await this.fetchTransactionReceipts(stats, provider);

        // Fetch block info
        const blockInfoMap = await this.fetchBlockInfo(stats, provider);

        // Print the block utilization data
        this.printBlockData(blockInfoMap);

        // Print the final TPS and avg. utilization data
        const avgTPS = await this.calcTPS(stats, provider);
        this.printFinalData(avgTPS, blockInfoMap);

        return new CollectorData(avgTPS, blockInfoMap);
    }
}

export { TxStats, StatCollector, CollectorData, BlockInfo };
