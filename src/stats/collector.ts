import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { SingleBar } from 'cli-progress';
import Table from 'cli-table';
import Logger from '../logger/logger';

class TxStats {
    txHash: string;
    block: number = 0;

    constructor(txHash: string) {
        this.txHash = txHash;
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

        const largeDivision = gasUsed
            .mul(BigNumber.from(10000))
            .div(gasLimit)
            .toNumber();

        this.gasUtilization = largeDivision / 100;
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

    async calcTPS(stats: TxStats[], provider: Provider): Promise<number> {
        Logger.title('\n🧮 Calculating TPS data 🧮');
        let totalTxs = 0;
        let totalTime = 0;

        // Find the average txn time per block
        const blockFetchErrors = [];
        const blockTimeMap: Map<number, number> = new Map<number, number>();
        const uniqueBlocks = new Set<number>();

        for (let stat of stats) {
            if (stat.block == 0) {
                continue;
            }

            totalTxs++;
            uniqueBlocks.add(stat.block);
        }

        for (const block of uniqueBlocks) {
            // Get the parent block to find the generation time
            try {
                // TODO handle genesis block case (no parent)
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

        return totalTxs / totalTime;
    }

    printBlockData(blockInfoMap: Map<number, blockInfo>) {
        Logger.info('\nBlock utilization data:');
        const utilizationTable = new Table({
            head: [
                'Block #',
                'Gas Used [wei]',
                'Gas Limit [wei]',
                'Utilization',
            ],
        });

        const sortedMap = new Map(
            [...blockInfoMap.entries()].sort((a, b) => a[0] - b[0])
        );

        sortedMap.forEach((info) => {
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

        this.printBlockData(blockInfoMap);

        // Get the average TPS
        // TODO optimize this call with the block info map
        const avgTPS = await this.calcTPS(stats, provider);

        Logger.info(`\nTotal blocks required: ${blockInfoMap.size}`);
        Logger.info(`TPS: ${Math.ceil(avgTPS)}`);
    }
}

export { TxStats, StatCollector };
