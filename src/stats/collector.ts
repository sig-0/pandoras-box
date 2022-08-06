import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { SingleBar } from 'cli-progress';
import Table from 'cli-table';
import Logger from '../logger/logger';

class TxStats {
    txHash: string;
    createdAt: number;
    includedAt: number = 0;
    block: number = 0;

    constructor(txHash: string, createdAt: number) {
        this.txHash = txHash;
        this.createdAt = createdAt;
    }

    // Returns the transaction turn around time in seconds
    calculateTxTime(): number {
        const creationDate = new Date(this.createdAt);
        const inclusionDate = new Date(this.includedAt * 1000);

        return Math.abs(
            (inclusionDate.getTime() - creationDate.getTime()) / 1000
        );
    }
}

class blockInfo {
    blockNum: number;
    createdAt: number;
    numTxs: number;

    gasUsed: BigNumber;
    gasLimit: BigNumber;
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
        this.gasUsed = gasUsed;
        this.gasLimit = gasLimit;

        const wholePart = gasUsed
            .mul(BigNumber.from(10000))
            .div(gasLimit)
            .toNumber();
        const decimalPart = (wholePart % 100) / 100;

        this.gasUtilization = wholePart + decimalPart;
        // const decimalPart = (this.gasUtilization = gasUsed
        //     .div(gasLimit)
        //     .mul(BigNumber.from(100))
        //     .toNumber());
    }
}

class StatCollector {
    async fetchTransactionReceipts(stats: TxStats[], provider: Provider) {
        const txFetchErrors: Error[] = [];

        Logger.info('\nGathering transaction receipts...');
        const receiptBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        receiptBar.start(stats.length, 0, {
            speed: 'N/A',
        });

        // Wait for all the transactions to get mined
        for (let txStat of stats) {
            try {
                const txReceipt = await provider.waitForTransaction(
                    txStat.txHash,
                    1,
                    60 * 10000
                );

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

            for (let err of txFetchErrors) {
                Logger.error(err.message);
            }
        }
    }

    async fetchBlockInfo(
        stats: TxStats[],
        provider: Provider
    ): Promise<Map<number, blockInfo>> {
        let blockSet: Set<number> = new Set<number>();
        for (let s of stats) {
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

        const blocksMap: Map<number, blockInfo> = new Map<number, blockInfo>();
        for (let block of blockSet.keys()) {
            try {
                const fetchedInfo = await provider.getBlock(block);

                blocksBar.increment();

                blocksMap.set(
                    block,
                    new blockInfo(
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

            for (let err of blockFetchErrors) {
                Logger.error(err.message);
            }
        }

        return blocksMap;
    }

    updateTxStats(stats: TxStats[], blockInfo: Map<number, blockInfo>) {
        for (let stat of stats) {
            const block = blockInfo.get(stat.block) as blockInfo;

            stat.includedAt = block.createdAt;
        }
    }

    calcTPS(stats: TxStats[]): number {
        let totalTime = 0;
        let totalTxs = 0;

        // Find the average txn time per block
        const blockAvgTimes = new Map<number, number>();
        const uniqueBLocks = new Set<number>();
        for (let stat of stats) {
            if (stat.block == 0) {
                continue;
            }

            totalTxs++;
            uniqueBLocks.add(stat.block);
        }

        uniqueBLocks.forEach((block) => {
            let sumBlockTime = 0;
            let totalTxnNum = 0;

            for (let stat of stats) {
                if (stat.block != block) {
                    continue;
                }

                sumBlockTime += stat.calculateTxTime();
                totalTxnNum++;
            }

            blockAvgTimes.set(block, sumBlockTime / totalTxnNum);
        });

        // Sum block times
        blockAvgTimes.forEach((blockTimeAvg, blockNum) => {
            totalTime += blockTimeAvg;
        });

        return totalTxs / totalTime;
    }

    printBlockData(blockInfoMap: Map<number, blockInfo>) {
        Logger.info('Block utilization data:');
        const utilizationTable = new Table({
            head: [
                'Block #',
                'Gas Used [wei]',
                'Gas Limit [wei]',
                'Utilization',
            ],
        });

        blockInfoMap.forEach((info) => {
            utilizationTable.push([
                `Block #${info.blockNum}`,
                info.gasUsed.toHexString(),
                info.gasLimit.toHexString(),
                `${info.gasUtilization}%`,
            ]);
        });

        Logger.info(utilizationTable.toString());
    }

    async generateStats(stats: TxStats[], mnemonic: string, url: string) {
        if (stats.length == 0) {
            Logger.warn('No stat data to display');

            return;
        }

        Logger.title('\n⏱ Started statistics calculation ⏱\n');

        const provider = new JsonRpcProvider(url);

        // Fetch receipts
        await this.fetchTransactionReceipts(stats, provider);

        // Fetch block info
        const blockInfoMap = await this.fetchBlockInfo(stats, provider);

        // Update the transaction stats
        this.updateTxStats(stats, blockInfoMap);

        // Get the average TPS
        const avgTPS = this.calcTPS(stats);

        Logger.info(`\nTPS: ${avgTPS}`);

        this.printBlockData(blockInfoMap);
    }
}

export { TxStats, StatCollector };
