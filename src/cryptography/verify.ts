import { md, pki, util } from "node-forge";
import { canonicalizeFact } from "../fact/hash";
import { FactEnvelope, FactSignature } from "../storage";
import { Trace } from "../util/trace";

export function verifyEnvelopes(envelope: FactEnvelope[]): boolean {
    return envelope.every(e => verifySignatures(e));
}

function verifySignatures(envelope: FactEnvelope): boolean {
    const canonicalString = canonicalizeFact(envelope.fact.fields, envelope.fact.predecessors);
    const encodedString = util.encodeUtf8(canonicalString);
    const digest = md.sha512.create().update(encodedString);
    const hash = util.encode64(digest.digest().getBytes());
    if (envelope.fact.hash !== hash) {
        Trace.error(`Hash does not match. "${envelope.fact.hash}" !== "${hash}"\nFact: ${canonicalString}`);
        return false;
    }
    return envelope.signatures.every(s => verifySignature(s, digest));
}

function verifySignature(signature: FactSignature, digest: md.sha512.Sha512MessageDigest) {
    const publicKey = pki.publicKeyFromPem(signature.publicKey);
    const signatureBytes = util.decode64(signature.signature);
    try {
        return publicKey.verify(digest.digest().getBytes(), signatureBytes);
    }
    catch (e) {
        Trace.error(`Failed to verify signature. ${e}`);
        return false;
    }
}