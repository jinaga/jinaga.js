import { pki } from "node-forge";
import { computeHash } from '../fact/hash';
import { Keystore, UserIdentity } from "../keystore";
import { FactRecord, FactSignature, PredecessorCollection } from "../storage";

export class MemoryKeystore implements Keystore {
    private keyPairs: { [key: string]: { publicKey: string, privateKey: string }} = {};

    close(): Promise<void> {
        return Promise.resolve();
    }

    getUserFact(userIdentity: UserIdentity): Promise<FactRecord> {
        return Promise.resolve(this.getIdentityFact('Jinaga.User', userIdentity));
    }
    
    getDeviceFact(userIdentity: UserIdentity): Promise<FactRecord> {
        return Promise.resolve(this.getIdentityFact('Jinaga.Device', userIdentity));
    }

    signFact(userIdentity: UserIdentity, fact: FactRecord): Promise<FactSignature[]> {
        return Promise.resolve([]);
    }

    private getIdentityFact(type: string, identity: UserIdentity): FactRecord {
        if (!identity) {
            return null;
        }
        const publicKey = this.getPublicKey(identity);
        const predecessors: PredecessorCollection = {};
        const fields = {
            publicKey: publicKey
        };
        const hash = computeHash(fields, predecessors);
        return { type, hash, predecessors, fields };
    }

    private getPublicKey(userIdentity: UserIdentity): string {
        const key = `${userIdentity.provider}:${userIdentity.id}`;
        const keyPair = this.keyPairs[key];
        if (keyPair) {
            return keyPair.publicKey;
        }
        else {
            return this.generateKeyPair(key);
        }
    }

    private generateKeyPair(key: string) {
        const keypair = pki.rsa.generateKeyPair({ bits: 1024 });
        const privateKey = pki.privateKeyToPem(keypair.privateKey);
        const publicKey = pki.publicKeyToPem(keypair.publicKey);
        this.keyPairs[key] = { publicKey, privateKey };
        return publicKey;
    }
}