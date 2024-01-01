import { computeHash, verifyHash } from '../fact/hash';
import { TopologicalSorter } from '../fact/sorter';
import { FactEnvelope, FactRecord, FactReference, Storage, factReferenceEquals } from '../storage';
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

type AuthorizationVerdictOld = "New" | "Signed" | "Existing" | "Forbidden";

type AuthorizationResultOld = {
    fact: FactRecord;
    verdict: AuthorizationVerdictOld
};

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

    async authorizeFacts(facts: FactRecord[], userFact: FactRecord | null): Promise<FactRecord[]> {
        const existing = await this.store.whichExist(facts);
        const sorter = new TopologicalSorter<Promise<AuthorizationResultOld>>();
        const results = await mapAsync(sorter.sort(facts, (p, f) => this.visitOld(p, f, userFact, facts, existing)), x => x);
        const rejected = results.filter(r => r.verdict === "Forbidden");
        if (rejected.length > 0) {
            const distinctTypes = rejected
                .map(r => r.fact.type)
                .filter(distinct)
                .join(", ");
            const count = rejected.length === 1 ? "1 fact" : `${rejected.length} facts`;
            const message = `Rejected ${count} of type ${distinctTypes}.`;
            throw new Forbidden(message);
        }
        const authorizedFacts = results
            .filter(r => r.verdict === "New" || r.verdict === "Signed")
            .map(r => r.fact);
        return authorizedFacts;
    }

    async authorizeFactsNew(factEnvelopes: FactEnvelope[], userFact: FactRecord | null): Promise<AuthorizationResult[]> {
        const facts = factEnvelopes.map(e => e.fact);
        const existing = await this.store.whichExist(facts);
        const sorter = new TopologicalSorter<Promise<AuthorizationResult>>();
        const results = await mapAsync(sorter.sort(facts, (p, f) => this.visit(p, f, userFact, facts, factEnvelopes, existing)), x => x);
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

    private async visit(predecessors: Promise<AuthorizationResult>[], fact: FactRecord, userFact: FactRecord | null, factRecords: FactRecord[], factEnvelopes: FactEnvelope[], existing: FactReference[]): Promise<AuthorizationResult> {
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

        const isFact = factReferenceEquals(fact);
        if (existing.some(isFact)) {
            return { fact, verdict: "Existing" };
        }

        const envelope = factEnvelopes.find(e => isFact(e.fact));
        const envelopeKeys = envelope ? envelope.signatures.map(s => s.publicKey) : [];
        const userKeys : string[] = (userFact && userFact.fields.hasOwnProperty("publicKey"))
            ? [ userFact.fields.publicKey ]
            : [];
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

    private async visitOld(predecessors: Promise<AuthorizationResultOld>[], fact: FactRecord, userFact: FactRecord | null, factRecords: FactRecord[], existing: FactReference[]): Promise<AuthorizationResultOld> {
        const predecessorResults = await mapAsync(predecessors, p => p);
        const verdict = await this.authorizeOld(predecessorResults, userFact, fact, factRecords, existing);
        return { fact, verdict };
    }

    private async authorizeOld(predecessors: AuthorizationResultOld[], userFact: FactRecord | null, fact: FactRecord, factRecords: FactRecord[], existing: FactReference[]) : Promise<AuthorizationVerdictOld> {
        if (predecessors.some(p => p.verdict === "Forbidden")) {
            const predecessor = predecessors
                .filter(p => p.verdict === 'Forbidden')
                .map(p => p.fact.type)
                .join(', ');
            Trace.warn(`The fact ${fact.type} cannot be authorized because its predecessor ${predecessor} is not authorized.`);
            return "Forbidden";
        }

        if (!verifyHash(fact)) {
            const computedHash = computeHash(fact.fields, fact.predecessors);
            Trace.warn(`The hash of ${fact.type} does not match: computed ${computedHash}, provided ${fact.hash}.`);
            return "Forbidden";
        }

        const candidateKeys : string[]= (userFact && userFact.fields.hasOwnProperty("publicKey")) ? [ userFact.fields.publicKey ] : [];
        const population = await this.authorizationRules.getAuthorizedPopulation(candidateKeys, fact, factRecords, this.store);
        const isAuthorized = population.quantifier === "everyone" ||
            population.quantifier === "some" && population.authorizedKeys.length > 0;
        if (predecessors.some(p => p.verdict === "New") || !existing.some(f => f.hash === fact.hash && f.type === fact.type)) {
            if (!isAuthorized) {
                if (this.authorizationRules.hasRule(fact.type)) {
                    Trace.warn(`The user is not authorized to create a fact of type ${fact.type}.`);
                } else {
                    Trace.warn(`The fact ${fact.type} has no authorization rules.`);
                }
            }
            return isAuthorized ? "New" : "Forbidden";
        }

        return isAuthorized ? "Signed" : "Existing";
    }
}
