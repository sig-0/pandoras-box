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

class StatCollector {}

export { TxStats, StatCollector };
