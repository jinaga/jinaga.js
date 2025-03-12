import { md, pki, util } from "node-forge";
import { canonicalizeFact } from "../fact/hash";
import { FactEnvelope, FactRecord } from "../storage";
import { Trace } from "../util/trace";

export interface KeyPair {
    publicPem: string;
    privatePem: string;
    singleUseKeyPair?: KeyPair | null;
}

export function generateKeyPair(): KeyPair {
    const keypair = pki.rsa.generateKeyPair({ bits: 2048 });
    const privatePem = pki.privateKeyToPem(keypair.privateKey);
    const publicPem = pki.publicKeyToPem(keypair.publicKey);
    return { privatePem, publicPem };
}

export function signFacts(keyPair: KeyPair, facts: FactRecord[]): FactEnvelope[] {
    const privateKey = <pki.rsa.PrivateKey>pki.privateKeyFromPem(keyPair.privatePem);
    const envelopes: FactEnvelope[] = facts.map(fact => signFact(fact, keyPair.publicPem, privateKey));
    return envelopes;
}

function signFact(fact: FactRecord, publicPem: string, privateKey: pki.rsa.PrivateKey): FactEnvelope {
    const canonicalString = canonicalizeFact(fact.fields, fact.predecessors);
    const encodedString = util.encodeUtf8(canonicalString);
    const digest = md.sha512.create().update(encodedString);
    const hash = util.encode64(digest.digest().getBytes());
    if (fact.hash !== hash) {
        Trace.error(`Hash does not match. "${fact.hash}" !== "${hash}"\nFact: ${canonicalString}`);
        return {
            fact,
            signatures: []
        };
    }
    const signature = util.encode64(privateKey.sign(digest));
    return {
        fact,
        signatures: [{
            signature,
            publicKey: publicPem
        }]
    };
}

export function BeginSingleUse(): KeyPair {
    const keyPair = generateKeyPair();
    keyPair.singleUseKeyPair = keyPair;
    return keyPair;
}

export function EndSingleUse(keyPair: KeyPair): void {
    keyPair.singleUseKeyPair = null;
}
