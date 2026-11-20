import { computeObjectHash } from "./fact/hash";
import { Specification } from "./specification/specification";
import { findIndex } from './util/fn';
import { Trace } from "./util/trace";

export type FactReference = {
    type: string;
    hash: string;
};

export interface FactTuple {
    facts: FactReference[];
    bookmark: string;
}

export interface FactFeed {
    tuples: FactTuple[];
    bookmark: string;
}

export type PredecessorCollection = {
    [role: string]: FactReference[] | FactReference
};

export type FactRecord = {
    type: string;
    hash: string;
    predecessors: PredecessorCollection,
    fields: { [field: string]: any };
};

export type FactSignature = {
    publicKey: string;
    signature: string;
}

export type FactEnvelope = {
    fact: FactRecord;
    signatures: FactSignature[];
}

export type ReferencesByName = { [name: string]: FactReference };

export interface ProjectedResult {
    tuple: ReferencesByName;
    result: any;
}

export interface Storage {
    close(): Promise<void>;
    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]>;
    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]>;
    /**
     * Read as though `staged` had been saved, with one exception. Beneath a
     * negative existential condition, at any depth, a successor walk finds only
     * the facts actually saved, while a predecessor walk reads the predecessors
     * of a staged fact as well as of a saved one. Saves nothing.
     *
     * A store implements this so that a batch can be authorized as one unit: a
     * rule's tail reads the store plus the facts of the batch accepted so far,
     * rather than the store alone. Without it the verdict on a fact depends on
     * how the sender cut its requests, because nothing in a batch is in the
     * store until the whole batch has been authorized.
     *
     * The facts of a batch are concurrent, so a fact that a negative condition
     * forbids takes effect for facts that arrive in a later call, never for
     * facts that arrive with it. The matches and the positive existential
     * conditions see `staged`; beneath a negative existential condition, every
     * fact the condition introduces is drawn from the saved graph, which is
     * what a successor walk there reads. A predecessor walk reads a staged
     * fact's own predecessors all the same, so a condition that joins through
     * the fact a match found still reaches a witness the store already held:
     * a fact saved before the batch cannot have a staged predecessor, because
     * a fact never arrives before its predecessors, so reading them withdraws
     * no witness. Accepting a fact can then satisfy more positive conditions
     * and can never withdraw a negative one, which is what makes a batch's
     * verdict independent of the order it arrived in.
     *
     * One call reads one graph, as `read` does: a save that lands while the
     * specification is being run cannot move the graph underneath it. Two calls
     * are two reads, so a save that lands between them is visible to the later
     * one, and a batch decided over several calls can see a fact appear beneath
     * a negative condition partway through. That is the behavior every read in
     * this library has, rather than anything this method introduces, and
     * closing it would take a snapshot that outlives a call, which this
     * interface has no way to name. A negation over one replica's graph is
     * provisional in any case: no witness here is not no witness anywhere.
     *
     * The staged facts are not saved, and a store that does not implement this
     * method gets a single pass in which every tail reads the store alone.
     */
    readAsIfSaved?(staged: FactEnvelope[], start: FactReference[], specification: Specification): Promise<ProjectedResult[]>;
    feed(feed: Specification, start: FactReference[], bookmark: string): Promise<FactFeed>;
    whichExist(references: FactReference[]): Promise<FactReference[]>;
    load(references: FactReference[]): Promise<FactEnvelope[]>;
    purge(purgeConditions: Specification[]): Promise<number>;
    purgeDescendants(purgeRoot: FactReference, triggers: FactReference[]): Promise<number>;

    loadBookmark(feed: string): Promise<string>;
    saveBookmark(feed: string, bookmark: string): Promise<void>;

    getMruDate(specificationHash: string): Promise<Date | null>;
    setMruDate(specificationHash: string, mruDate: Date): Promise<void>;
}

/**
 * A fact waiting in the outgoing queue, with the user who was current when it
 * was written (issue #412).
 *
 * The replicator attributes a saved fact to the user on the request's token, so
 * a client that sends a queued fact under someone else's token has it judged,
 * and signed where a rule requires a signature, as that person's write. The
 * user recorded here is what lets a flush tell the difference.
 *
 * `user` is absent when there was no current user to record: a fact written
 * before any login resolved, or an entry a client wrote before it recorded the
 * user at all. Absent means "send as before", so a `Queue` that does not record
 * the user returns plain envelopes and keeps the behavior it has.
 */
export interface QueuedEnvelope extends FactEnvelope {
    user?: FactReference;
}

export interface Queue {
    peek(): Promise<QueuedEnvelope[]>;
    /**
     * Add facts to the queue, recording the user who is current now.
     *
     * The user is optional, and a queue with no notion of a logged-in user --
     * a replicator's own queue, for instance -- ignores it.
     */
    enqueue(envelopes: FactEnvelope[], user?: FactReference): Promise<void>;
    dequeue(envelopes: FactEnvelope[]): Promise<void>;
}

export function factReferenceEquals(a: FactReference) {
    return (r: FactReference) => r.hash === a.hash && r.type === a.type;
}

export function factEnvelopeEquals(r: FactReference) {
    return (e: FactEnvelope) => e.fact.hash === r.hash && e.fact.type === r.type;
}

export function uniqueFactReferences(references: FactReference[]): FactReference[] {
    return references.filter((value, index, array) => {
        return findIndex(array, factReferenceEquals(value)) === index;
    });
}

export function computeTupleSubsetHash(tuple: ReferencesByName, subset: string[]) {
    const parentTuple = Object.getOwnPropertyNames(tuple)
        .filter(name => subset.some(s => s === name))
        .reduce((t, name) => ({
            ...t,
            [name]: tuple[name]
        }),
            {} as ReferencesByName);
    const parentTupleHash = computeObjectHash(parentTuple);
    return parentTupleHash;
}

export function validateGiven(start: FactReference[], specification: Specification) {
    // Verify that the number of start facts equals the number of inputs
    if (start.length !== specification.given.length) {
        throw new Error(`The number of start facts (${start.length}) does not equal the number of inputs (${specification.given.length})`);
    }
    // Verify that the input type matches the start fact type
    for (let i = 0; i < start.length; i++) {
        if (start[i].type !== specification.given[i].label.type) {
            throw new Error(`The type of start fact ${i} (${start[i].type}) does not match the type of input ${i} (${specification.given[i].label.type})`);
        }
    }
}

/**
 * Save a graph and notify exactly the envelopes the store reports as added.
 *
 * A graph is a predecessor closure: `/load` and a graph stream both answer with
 * a fact together with everything it depends on, so a graph routinely carries
 * facts the store already holds. Every inverse is derived on the premise that
 * its given was just inserted and therefore has no successors, which is what
 * lets `simplifyMatch` drop the successor conditions of the level it solves
 * (`src/specification/inverse.ts`; axiom A3 in
 * `docs/analysis/specification-invariants.md`). Notify a fact the store already
 * held and that premise is false: the fact's "add" inverse runs without the
 * `notExists` conditions that excluded it, and a listener is offered a row its
 * own store rejects.
 *
 * `Storage.save` reports which envelopes it actually added, and that report is
 * what carries the premise. This is the one place that turns a saved graph into
 * a notification; every caller that saves a graph goes through here, and none
 * reaches its notification another way.
 *
 * @param onSaveStarted Called with the save still in flight, for a caller that
 * must let something else wait on persistence alone rather than on persistence
 * and notification together.
 */
export async function saveAndNotify(
    store: Storage,
    envelopes: FactEnvelope[],
    notifyFactsAdded: ((added: FactEnvelope[]) => Promise<void>) | undefined,
    onSaveStarted?: (saving: Promise<FactEnvelope[]>) => void
): Promise<FactEnvelope[]> {
    const saving = store.save(envelopes);
    if (onSaveStarted) {
        onSaveStarted(saving);
    }
    const added = await saving;
    if (added.length > 0) {
        Trace.counter("facts_saved", added.length);
        if (notifyFactsAdded) {
            await notifyFactsAdded(added);
        }
    }
    return added;
}
