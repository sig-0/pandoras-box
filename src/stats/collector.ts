import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { SingleBar } from 'cli-progress';
import Table from 'cli-table';
import Logger from '../logger/logger';

interface Runtime {
    run(): Promise<TxStats[]>;
}

class TxStats {
    txHash: string;
    createdAt: number;
    includedAt: number = 0;
    block: number = 0;

    constructor(txHash: string, createdAt: number) {
        this.txHash = txHash;
        this.createdAt = createdAt;
    }

    setIncludedAt(includedAt: number) {
        this.includedAt = includedAt;
    }

    setBlock(block: number) {
        this.block = block;
    }

    // Returns the transaction turn around time in seconds
    calculateTxTime(): number {
        const creationDate = new Date(this.createdAt * 1000);
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

        this.gasUtilization = gasUsed
            .div(gasLimit)
            .mul(BigNumber.from(100))
            .toNumber();
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
        for (let txStat of stats) {
            try {
                const txReceipt = await provider.waitForTransaction(
                    txStat.txHash
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

        Logger.info('Gathering block info...');
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
        for (let stat of stats) {
            totalTime += stat.calculateTxTime();
        }

        return stats.length / totalTime;
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

    async generateStats(runtime: Runtime, mnemonic: string, url: string) {
        // Run the runtime first
        const stats = await runtime.run();

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

        Logger.title(`The measured TPS: ${avgTPS}`);

        this.printBlockData(blockInfoMap);
    }
}

export { TxStats, StatCollector };
