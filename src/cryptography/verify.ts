import { md, pki, util } from "node-forge";
import { canonicalizeFact } from "../fact/hash";
import { FactEnvelope, FactSignature } from "../storage";
import { Trace } from "../util/trace";

type PublicKeyCache = { [key: string]: pki.rsa.PublicKey };

export function verifyEnvelopes(envelopes: FactEnvelope[]): boolean {
    // Cache public keys to avoid parsing them multiple times
    const publicKeyCache: PublicKeyCache = {};

    for (var envelope of envelopes) {
        for (var signature of envelope.signatures) {
            if (!publicKeyCache[signature.publicKey]) {
                publicKeyCache[signature.publicKey] = pki.publicKeyFromPem(signature.publicKey);
            }
        }
    }

    return envelopes.every(e => verifySignatures(e, publicKeyCache));
}

function verifySignatures(envelope: FactEnvelope, publicKeyCache: PublicKeyCache): boolean {
    const canonicalString = canonicalizeFact(envelope.fact.fields, envelope.fact.predecessors);
    const encodedString = util.encodeUtf8(canonicalString);
    const digest = md.sha512.create().update(encodedString);
    const hash = util.encode64(digest.digest().getBytes());
    if (envelope.fact.hash !== hash) {
        Trace.error(`Hash does not match. "${envelope.fact.hash}" !== "${hash}"\nFact: ${canonicalString}`);
        return false;
    }
    const digestBytes = digest.digest().getBytes();
    return envelope.signatures.every(s => verifySignature(s, digestBytes, publicKeyCache));
}

function verifySignature(signature: FactSignature, digestBytes: string, publicKeyCache: PublicKeyCache) {
    const publicKey = publicKeyCache[signature.publicKey];
    const signatureBytes = util.decode64(signature.signature);
    try {
        return publicKey.verify(digestBytes, signatureBytes);
    }
    catch (e) {
        Trace.error(`Failed to verify signature. ${e}`);
        return false;
    }
}