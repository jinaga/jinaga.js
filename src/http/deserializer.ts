import { computeHash } from "../fact/hash";
import { FactEnvelope, FactReference, FactRecord, PredecessorCollection, FactSignature } from "../storage";

export interface GraphSource {
    read(
        onEnvelopes: (envelopes: FactEnvelope[]) => Promise<void>
    ): Promise<void>;
}

export class GraphDeserializer implements GraphSource {
    private factReferences: FactReference[] = [];
    private publicKeys: string[] = [];

    constructor(
        private readonly readLine: () => Promise<string | null>,
        private readonly flushThreshold: number = 20
    ) {}

    async read(
        onEnvelopes: (envelopes: FactEnvelope[]) => Promise<void>
    ) {
        let envelopes: FactEnvelope[] = [];
        let line: string | null;
        while ((line = await this.readLine()) !== null) {
            if (line === "") {
                // Skip stray blank lines between blocks
                continue;
            }
            if (line.startsWith("PK")) {
                const index = parseInt(line.substring(2));
                await this.readPublicKey(index);
            }
            else {
                const type = JSON.parse(line);
                envelopes = await this.readEnvelope(type, envelopes, onEnvelopes);
            }
        }
        if (envelopes.length > 0) {
            await onEnvelopes(envelopes);
        }
    }

    private async readPublicKey(index: number) {
        if (index !== this.publicKeys.length) {
            throw new Error(`Public key index ${index} is out of order`);
        }
        const publicKey = await this.parseNextJSONLine();
        const emptyLine = await this.readLine();
        if (emptyLine !== "") {
            throw new Error(`Expected empty line after public key, but got "${emptyLine}"`);
        }
        this.publicKeys.push(publicKey);
    }

    private async readEnvelope(type: string, envelopes: FactEnvelope[], onEnvelopes: (envelopes: FactEnvelope[]) => Promise<void>) {
        const predecessorIndexes = await this.parseNextJSONLine();
        const fields = await this.parseNextJSONLine();

        const predecessors = this.getPredecessorReferences(predecessorIndexes);

        const hash = computeHash(fields, predecessors);
        this.factReferences.push({ type, hash });
        const fact: FactRecord = { type, hash, predecessors, fields };

        const signatures = await this.readSignatures();

        envelopes.push({ fact, signatures });

        // Periodically handle a batch of envelopes
        if (envelopes.length >= this.flushThreshold) {
            await onEnvelopes(envelopes);
            envelopes = [];
        }
        return envelopes;
    }

    private getPredecessorReferences(predecessorIndexes: any) {
        const predecessors: PredecessorCollection = {};
        for (const role in predecessorIndexes) {
            const index = predecessorIndexes[role];
            if (Array.isArray(index)) {
                predecessors[role] = index.map(i => {
                    if (i >= this.factReferences.length) {
                        throw new Error(`Predecessor reference ${i} is out of range`);
                    }
                    return this.factReferences[i];
                });
            } else {
                if (index >= this.factReferences.length) {
                    throw new Error(`Predecessor reference ${index} is out of range`);
                }
                predecessors[role] = this.factReferences[index];
            }
        }
        return predecessors;
    }

    private async readSignatures(): Promise<FactSignature[]> {
        const signatures: FactSignature[] = [];
        let line: string | null;
        while ((line = await this.readLine()) !== null && line !== "") {
            if (!line.startsWith("PK")) {
                throw new Error(`Expected public key reference, but got "${line}"`);
            }
            const publicKeyIndex = parseInt(line.substring(2));
            if (publicKeyIndex >= this.publicKeys.length) {
                throw new Error(`Public key reference ${publicKeyIndex} is out of range`);
            }
            const publicKey = this.publicKeys[publicKeyIndex];
            const signature = await this.parseNextJSONLine();

            signatures.push({ publicKey, signature });
        }
        return signatures;
    }

    private async parseNextJSONLine() {
        const line = await this.readLine();
        if (!line) {
            throw new Error("Expected JSON line, but got end of file");
        }
        return JSON.parse(line);
    }
}