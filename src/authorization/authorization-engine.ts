import { computeHash, verifyHash } from '../fact/hash';
import { TopologicalSorter } from '../fact/sorter';
import { ObservableSource } from '../observable/observable';
import { FactRecord, FactReference } from '../storage';
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

type AuthorizationVerdict = "New" | "Signed" | "Existing" | "Forbidden";

type AuthorizationResult = {
    fact: FactRecord;
    verdict: AuthorizationVerdict
};

export class AuthorizationEngine {
    constructor(
        private authorizationRules: AuthorizationRules,
        private feed: ObservableSource
    ) { }

    async authorizeFacts(facts: FactRecord[], userFact: FactRecord | null) {
        const existing = await this.feed.whichExist(facts);
        const sorter = new TopologicalSorter<Promise<AuthorizationResult>>();
        const results = await mapAsync(sorter.sort(facts, (p, f) => this.visit(p, f, userFact, facts, existing)), x => x);
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


    private async visit(predecessors: Promise<AuthorizationResult>[], fact: FactRecord, userFact: FactRecord | null, factRecords: FactRecord[], existing: FactReference[]): Promise<AuthorizationResult> {
        const predecessorResults = await mapAsync(predecessors, p => p);
        const verdict = await this.authorize(predecessorResults, userFact, fact, factRecords, existing);
        return { fact, verdict };
    }

    private async authorize(predecessors: AuthorizationResult[], userFact: FactRecord | null, fact: FactRecord, factRecords: FactRecord[], existing: FactReference[]) : Promise<AuthorizationVerdict> {
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

        const isAuthorized = await this.authorizationRules.isAuthorized(userFact, fact, factRecords, this.feed);
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
