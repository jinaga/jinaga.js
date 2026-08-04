import { computeHash, verifyHash } from '../fact/hash';
import { TopologicalSorter } from '../fact/sorter';
import { FactEnvelope, FactRecord, FactReference, Storage, factEnvelopeEquals, factReferenceEquals, uniqueFactReferences } from '../storage';
import { distinct, mapAsync } from '../util/fn';
import { Trace } from '../util/trace';
import { AuthorizationRules } from './authorizationRules';
import { AuthorizationRuleError, PredecessorNotResolvedError } from './errors';

function predecessorReferences(fact: FactRecord): FactReference[] {
    const references: FactReference[] = [];
    for (const role in fact.predecessors) {
        const value = fact.predecessors[role];
        if (Array.isArray(value)) {
            references.push(...value);
        }
        else if (value) {
            references.push(value);
        }
    }
    return references;
}

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

        // A fact in the batch may reference a predecessor that already exists in
        // storage but is not itself included in the batch (e.g. a new fact that
        // references an existing user from a prior login). Resolve those external
        // predecessors against the store so the sorter doesn't wait forever for a
        // predecessor that will never arrive in this batch.
        const externalReferences = uniqueFactReferences(facts.flatMap(predecessorReferences))
            .filter(reference => !facts.some(factReferenceEquals(reference)));

        const existing = await this.store.whichExist([...facts, ...externalReferences]);

        const sorter = new TopologicalSorter<Promise<AuthorizationResult>>();
        const missingPredecessors: FactReference[] = [];
        externalReferences.forEach(reference => {
            if (existing.some(factReferenceEquals(reference))) {
                sorter.markAsVisited(reference, Promise.resolve(<AuthorizationResult>{
                    fact: { type: reference.type, hash: reference.hash, predecessors: {}, fields: {} },
                    verdict: "Existing"
                }));
            }
            else {
                missingPredecessors.push(reference);
                Trace.warn(`The fact ${reference.type}:${reference.hash} is referenced as a predecessor but does not exist in storage and was not included in the batch. Facts that depend on it will not be authorized.`);
            }
        });

        const userKeys : string[] = (userFact && userFact.fields.hasOwnProperty("publicKey"))
            ? [ userFact.fields.publicKey ]
            : [];
        const results = await mapAsync(sorter.sort(facts, (p, f) => this.visit(p, f, userKeys, factEnvelopes, existing)), x => x);

        // TopologicalSorter silently omits any fact whose predecessors never all
        // become visited (most commonly a predecessor that is missing from both
        // the batch and storage). Detect that here so the caller gets a loud
        // failure instead of save()/commit() reporting success while quietly
        // dropping facts.
        const unresolved = facts.filter(f => !results.some(r => r.fact.type === f.type && r.fact.hash === f.hash));
        if (unresolved.length > 0) {
            const distinctTypes = unresolved
                .map(f => f.type)
                .filter(distinct)
                .join(", ");
            const count = unresolved.length === 1 ? "1 fact" : `${unresolved.length} facts`;
            // Name the predecessors that could not be found. They were already
            // identified above; previously only the failed successors reached the
            // message, which left the caller with nothing to act on (issue #234).
            const detail = missingPredecessors.length === 1
                ? `predecessor ${missingPredecessors[0].type}:${missingPredecessors[0].hash} does not exist in storage and was not included in the batch. Add it to the batch, or commit it first.`
                : missingPredecessors.length > 1
                    ? `the following predecessors do not exist in storage and were not included in the batch. Add them to the batch, or commit them first:\n${missingPredecessors.map(r => `${r.type}:${r.hash}`).join("\n")}`
                    : "one or more predecessors could not be resolved. This can happen when a predecessor does not exist in storage and was not included in the batch.";
            throw new PredecessorNotResolvedError(
                `Cannot authorize ${count} of type ${distinctTypes}: ${detail}`,
                missingPredecessors,
                unresolved.map(f => ({ type: f.type, hash: f.hash })));
        }

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

    private async visit(predecessors: Promise<AuthorizationResult>[], fact: FactRecord, userKeys: string[], factEnvelopes: FactEnvelope[], existing: FactReference[]): Promise<AuthorizationResult> {
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

        const envelope = factEnvelopes.find(factEnvelopeEquals(fact)) || { fact, signatures: [] };

        const population = await this.authorizationRules.getAuthorizedPopulationForEnvelope(userKeys, envelope, factEnvelopes, this.store);
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
            throw new AuthorizationRuleError(`Unknown quantifier ${(_exhaustiveCheck as any).quantifier}.`);
        }
    }
}
