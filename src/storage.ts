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

export interface Queue {
    peek(): Promise<FactEnvelope[]>;
    enqueue(envelopes: FactEnvelope[]): Promise<void>;
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
