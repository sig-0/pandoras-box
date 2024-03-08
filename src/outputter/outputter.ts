import FileSystem from 'fs';
import Logger from '../logger/logger';
import { BlockInfo, CollectorData } from '../stats/collector';

class outputFormat {
    averageTPS: number;
    minTPS: number;
    maxTPS: number;
    blocks: BlockInfo[];

    constructor(averageTPS: number, minTPS: number, maxTPS: number, blocks: BlockInfo[]) {
        this.averageTPS = averageTPS;
        this.minTPS = minTPS;
        this.maxTPS = maxTPS;
        this.blocks = blocks;
    }
}

class Outputter {
    public static outputData(data: CollectorData, path: string) {
        Logger.title('\n💾 Saving run results initialized 💾\n');

        const blocks: BlockInfo[] = [];
        data.blockInfo.forEach((block) => {
            blocks.push(block);
        });

        try {
            FileSystem.writeFile(
                path,
                JSON.stringify(new outputFormat(data.tps, data.minTps, data.maxTps, blocks)),
                (error) => {
                    if (error) throw error;
                }
            );

            Logger.success(`Run results saved to ${path}`);
        } catch (e: any) {
            Logger.error(`Unable to write output to file: ${e.message}`);
        }
    }
}

export default Outputter;
