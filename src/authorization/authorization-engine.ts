import { computeHash, verifyHash } from '../fact/hash';
import { TopologicalSorter } from '../fact/sorter';
import { Specification } from '../specification/specification';
import { FactEnvelope, FactFeed, FactRecord, FactReference, ProjectedResult, Storage, factEnvelopeEquals, factReferenceEquals, uniqueFactReferences } from '../storage';
import { distinct } from '../util/fn';
import { Trace } from '../util/trace';
import { AuthorizationStrata } from './authorization-strata';
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

function factKey(reference: FactReference): string {
    return `${reference.type}:${reference.hash}`;
}

/**
 * The facts of a batch grouped by stratum, the groups in stratum order and the
 * facts within a group in the order they were given. A stable sort, so the
 * topological order the sorter produced survives inside each group.
 */
function groupByStratum(sorted: FactRecord[], strata: AuthorizationStrata): { stratum: number, facts: FactRecord[] }[] {
    const groups: { stratum: number, facts: FactRecord[] }[] = [];
    for (const fact of sorted) {
        const stratum = strata.stratumOf(fact.type);
        const group = groups.find(g => g.stratum === stratum);
        if (group) {
            group.facts.push(fact);
        }
        else {
            groups.push({ stratum, facts: [ fact ] });
        }
    }
    return groups.sort((a, b) => a.stratum - b.stratum);
}

/**
 * A store that reads as though the facts of a batch accepted so far had been
 * saved. Every other operation is the underlying store's own: nothing is
 * written, and the staged facts are visible only to reads made through this
 * decorator.
 *
 * Only a store that implements `readAsIfSaved` can be staged. One that does not
 * is used directly, and every tail then reads the store alone, exactly as it
 * did before a batch was decided as one unit.
 */
class StagedStorage implements Storage {
    constructor(
        private readonly store: Storage,
        private readonly staged: FactEnvelope[]
    ) { }

    close(): Promise<void> {
        return this.store.close();
    }

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return this.store.save(envelopes);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.store.readAsIfSaved!(this.staged, start, specification);
    }

    readAsIfSaved(staged: FactEnvelope[], start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.store.readAsIfSaved!([ ...this.staged, ...staged ], start, specification);
    }

    feed(feed: Specification, start: FactReference[], bookmark: string): Promise<FactFeed> {
        return this.store.feed(feed, start, bookmark);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.store.whichExist(references);
    }

    load(references: FactReference[]): Promise<FactEnvelope[]> {
        return this.store.load(references);
    }

    purge(purgeConditions: Specification[]): Promise<number> {
        return this.store.purge(purgeConditions);
    }

    purgeDescendants(purgeRoot: FactReference, triggers: FactReference[]): Promise<number> {
        return this.store.purgeDescendants(purgeRoot, triggers);
    }

    loadBookmark(feed: string): Promise<string> {
        return this.store.loadBookmark(feed);
    }

    saveBookmark(feed: string, bookmark: string): Promise<void> {
        return this.store.saveBookmark(feed, bookmark);
    }

    getMruDate(specificationHash: string): Promise<Date | null> {
        return this.store.getMruDate(specificationHash);
    }

    setMruDate(specificationHash: string, mruDate: Date): Promise<void> {
        return this.store.setMruDate(specificationHash, mruDate);
    }
}

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

        // Resolve the order in which the batch is decided before deciding any
        // of it. A rule set whose negative conditions form a cycle has no such
        // order, and this is where a cycle closed by a predecessor role that
        // neither the model nor a rule declares is first visible.
        const strata = this.authorizationRules.strataForBatch(facts);

        const sorter = new TopologicalSorter<FactRecord>();
        const missingPredecessors: FactReference[] = [];
        externalReferences.forEach(reference => {
            if (existing.some(factReferenceEquals(reference))) {
                sorter.markAsVisited(reference, { type: reference.type, hash: reference.hash, predecessors: {}, fields: {} });
            }
            else {
                missingPredecessors.push(reference);
                Trace.warn(`The fact ${reference.type}:${reference.hash} is referenced as a predecessor but does not exist in storage and was not included in the batch. Facts that depend on it will not be authorized.`);
            }
        });

        const userKeys : string[] = (userFact && userFact.fields.hasOwnProperty("publicKey"))
            ? [ userFact.fields.publicKey ]
            : [];
        const sorted = sorter.sort(facts, (_, f) => f);

        // TopologicalSorter silently omits any fact whose predecessors never all
        // become visited (most commonly a predecessor that is missing from both
        // the batch and storage). Detect that here so the caller gets a loud
        // failure instead of save()/commit() reporting success while quietly
        // dropping facts.
        const unresolved = facts.filter(f => !sorted.some(r => r.type === f.type && r.hash === f.hash));
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

        const results = await this.decide(sorted, strata, userKeys, factEnvelopes, existing);

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

    /**
     * Decide the batch stratum by stratum.
     *
     * `sorted` is in topological order, so a fact's predecessors come before
     * it. Sorting that order by stratum keeps it, because a predecessor role is
     * an edge of the dependency graph and so never lands in a later stratum.
     *
     * Within a stratum each fact is decided once, with its rule tails reading
     * the store as though the facts accepted so far had been saved. A stratum
     * whose component holds a rule edge is decided again until a pass accepts
     * nothing new, because one fact in it can be admitted by another.
     *
     * Every type a tail reads lies in an earlier stratum or in the same
     * component, and a component with a negative edge was refused, so each read
     * sees exactly the facts of those types that this batch will commit:
     * a positive condition finds a fact accepted earlier in the batch, and a
     * negative condition forbids only a fact that will be saved.
     */
    private async decide(
        sorted: FactRecord[],
        strata: AuthorizationStrata,
        userKeys: string[],
        factEnvelopes: FactEnvelope[],
        existing: FactReference[]
    ): Promise<AuthorizationResult[]> {
        // A store that cannot read as if facts had been saved gets a single
        // pass in which every tail reads the store alone, which is the verdict
        // it gave before a batch was decided as one unit.
        const canStage = this.store.readAsIfSaved !== undefined;

        const verdicts = new Map<string, AuthorizationResult>();
        const accepted: FactEnvelope[] = [];

        for (const group of groupByStratum(sorted, strata)) {
            const iterate = canStage && strata.isRecursive(group.stratum);
            while (true) {
                let acceptedAny = false;
                for (const fact of group.facts) {
                    const key = factKey(fact);
                    const previous = verdicts.get(key);
                    if (previous !== undefined && previous.verdict !== "Reject") {
                        continue;
                    }
                    const result = await this.visit(fact, userKeys, factEnvelopes, existing, verdicts, canStage ? accepted : null);
                    verdicts.set(key, result);
                    if (result.verdict === "Accept") {
                        accepted.push(factEnvelopes.find(factEnvelopeEquals(fact)) || { fact, signatures: [] });
                        acceptedAny = true;
                    }
                    else if (result.verdict === "Existing") {
                        // Already in the store, so it needs no staging.
                        acceptedAny = true;
                    }
                }
                if (!iterate || !acceptedAny) {
                    break;
                }
            }
        }

        // Reported in the order the sort produced, as before.
        return sorted.map(fact => verdicts.get(factKey(fact))!);
    }

    private async visit(
        fact: FactRecord,
        userKeys: string[],
        factEnvelopes: FactEnvelope[],
        existing: FactReference[],
        verdicts: Map<string, AuthorizationResult>,
        accepted: FactEnvelope[] | null
    ): Promise<AuthorizationResult> {
        const rejectedPredecessors = predecessorReferences(fact)
            .filter(reference => !existing.some(factReferenceEquals(reference)))
            .filter(reference => {
                const result = verdicts.get(factKey(reference));
                return result === undefined || result.verdict === "Reject";
            });
        if (rejectedPredecessors.length > 0) {
            const predecessor = rejectedPredecessors
                .map(reference => reference.type)
                .filter(distinct)
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

        // The fact being decided is not among the staged facts: its own rule
        // walks successors of it, and a rule whose tail reads the fact itself is
        // refused where it is written.
        const store = (accepted !== null && accepted.length > 0)
            ? new StagedStorage(this.store, [ ...accepted ])
            : this.store;

        const population = await this.authorizationRules.getAuthorizedPopulationForEnvelope(userKeys, envelope, factEnvelopes, store);
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
