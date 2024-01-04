import { computeHash, verifyHash } from '../fact/hash';
import { TopologicalSorter } from '../fact/sorter';
import { FactEnvelope, FactRecord, FactReference, Storage, factEnvelopeEquals, factReferenceEquals } from '../storage';
import { distinct, mapAsync } from '../util/fn';
import { Trace } from '../util/trace';
import { AuthorizationRules } from './authorizationRules';

export class Forbidden extends Error {
    __proto__: Error;
    constructor(message?: string) {
        const trueProto = new.target.prototype;
        super(message);

        this.__proto__ = trueProto;
    }
}

type AuthorizationResultReject = {
    verdict: "Reject";
};

type AuthorizationResultAccept = {
    verdict: "Accept";
    newPublicKeys: string[];
};

type AuthorizationResultExisting = {
    verdict: "Existing";
};

export type AuthorizationResult = {
    fact: FactRecord;
} & (AuthorizationResultReject | AuthorizationResultAccept | AuthorizationResultExisting);

export class AuthorizationEngine {
    constructor(
        private authorizationRules: AuthorizationRules,
        private store: Storage
    ) { }

    async authorizeFacts(factEnvelopes: FactEnvelope[], userFact: FactRecord | null): Promise<AuthorizationResult[]> {
        const facts = factEnvelopes.map(e => e.fact);
        const existing = await this.store.whichExist(facts);
        const sorter = new TopologicalSorter<Promise<AuthorizationResult>>();
        const userKeys : string[] = (userFact && userFact.fields.hasOwnProperty("publicKey"))
            ? [ userFact.fields.publicKey ]
            : [];
        const results = await mapAsync(sorter.sort(facts, (p, f) => this.visit(p, f, userKeys, facts, factEnvelopes, existing)), x => x);
        const rejected = results.filter(r => r.verdict === "Reject");
        if (rejected.length > 0) {
            const distinctTypes = rejected
                .map(r => r.fact.type)
                .filter(distinct)
                .join(", ");
            const count = rejected.length === 1 ? "1 fact" : `${rejected.length} facts`;
            const message = `Rejected ${count} of type ${distinctTypes}.`;
            throw new Forbidden(message);
        }
        return results;
    }

    private async visit(predecessors: Promise<AuthorizationResult>[], fact: FactRecord, userKeys: string[], factRecords: FactRecord[], factEnvelopes: FactEnvelope[], existing: FactReference[]): Promise<AuthorizationResult> {
        const predecessorResults = await mapAsync(predecessors, p => p);
        if (predecessorResults.some(p => p.verdict === "Reject")) {
            const predecessor = predecessorResults
                .filter(p => p.verdict === "Reject")
                .map(p => p.fact.type)
                .join(', ');
            Trace.warn(`The fact ${fact.type} cannot be authorized because its predecessor ${predecessor} is not authorized.`);
            return { fact, verdict: "Reject" };
        }

        if (!verifyHash(fact)) {
            const computedHash = computeHash(fact.fields, fact.predecessors);
            Trace.warn(`The hash of ${fact.type} does not match: computed ${computedHash}, provided ${fact.hash}.`);
            return { fact, verdict: "Reject" };
        }

        if (existing.some(factReferenceEquals(fact))) {
            return { fact, verdict: "Existing" };
        }

        const envelope = factEnvelopes.find(factEnvelopeEquals(fact));
        const envelopeKeys = envelope ? envelope.signatures.map(s => s.publicKey) : [];
        const candidateKeys = envelopeKeys.concat(userKeys);

        const population = await this.authorizationRules.getAuthorizedPopulation(candidateKeys, fact, factRecords, this.store);
        if (population.quantifier === "none") {
            if (this.authorizationRules.hasRule(fact.type)) {
                Trace.warn(`The user is not authorized to create a fact of type ${fact.type}.`);
            } else {
                Trace.warn(`The fact ${fact.type} has no authorization rules.`);
            }
            return { fact, verdict: "Reject" };
        }
        else if (population.quantifier === "some") {
            if (population.authorizedKeys.length === 0) {
                Trace.warn(`The user is not authorized to create a fact of type ${fact.type}.`);
                return { fact, verdict: "Reject" };
            }
            return { fact, verdict: "Accept", newPublicKeys: population.authorizedKeys };
        }
        else if (population.quantifier === "everyone") {
            return { fact, verdict: "Accept", newPublicKeys: [] };
        }
        else {
            const _exhaustiveCheck: never = population;
            throw new Error(`Unknown quantifier ${(_exhaustiveCheck as any).quantifier}.`);
        }
    }
}
