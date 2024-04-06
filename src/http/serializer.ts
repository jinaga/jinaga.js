import { FactEnvelope, PredecessorCollection, FactReference } from "../storage";

export type IndexPredecessorCollection = {
    [role: string]: number | number[];
};

export class GraphSerializer
{
    private index = 0;
    private indexByFactReference: { [key: string]: number } = {};
    private publicKeys: string[] = [];

    constructor(
        private readonly write: (chunk: string) => void
    ) {}

    serialize(result: FactEnvelope[]) {
        // Write the facts
        for (const fact of result) {
            // Skip facts that have already been written
            const key = fact.fact.type + ":" + fact.fact.hash;
            if (this.indexByFactReference.hasOwnProperty(key)) {
                continue;
            }

            // Write any new public keys
            for (const signature of fact.signatures) {
                if (!this.publicKeys.includes(signature.publicKey)) {
                    const pkIndex = this.publicKeys.length;
                    const publicKey = JSON.stringify(signature.publicKey);
                    this.write(`PK${pkIndex.toString()}\n${publicKey}\n\n`);
                    this.publicKeys.push(signature.publicKey);
                }
            }

            // Write the fact
            const factType = JSON.stringify(fact.fact.type);
            const predecessorIndexes = JSON.stringify(this.getPredecessorIndexes(fact.fact.predecessors));
            const factFields = JSON.stringify(fact.fact.fields);

            let output = `${factType}\n${predecessorIndexes}\n${factFields}`;

            // Write the signatures
            for (const signature of fact.signatures) {
                const publicKeyIndex = this.publicKeys.indexOf(signature.publicKey);
                const publicKey = `PK${publicKeyIndex.toString()}`;
                const signatureString = JSON.stringify(signature.signature);

                output += `\n${publicKey}\n${signatureString}`;
            }

            output += "\n\n";

            this.write(output);

            this.indexByFactReference[key] = this.index;
            this.index++;
        }
    }

    private getPredecessorIndexes(predecessors: PredecessorCollection): IndexPredecessorCollection {
        const result: IndexPredecessorCollection = {};
        for (const role in predecessors) {
            const reference = predecessors[role];
            if (Array.isArray(reference)) {
                result[role] = reference.map(r => this.getFactIndex(r));
            } else {
                result[role] = this.getFactIndex(reference);
            }
        }
        return result;
    }

    private getFactIndex(reference: FactReference): number {
        const key = reference.type + ":" + reference.hash;
        if (!this.indexByFactReference.hasOwnProperty(key)) {
            throw new Error(`Fact reference not found in graph: ${key}`);
        }
        return this.indexByFactReference[key];
    }
}