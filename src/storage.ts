import { computeObjectHash } from "./fact/hash";
import { Specification } from "./specification/specification";
import { findIndex } from './util/fn';

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

/**
 * The outcome of evaluating a specification against a store (issue #232).
 *
 * A plain `ProjectedResult[]` cannot distinguish "the specification matched
 * nothing" from "a given fact is not materialized in this store", because both
 * are the empty array. Only the second means the read never really ran. This
 * sum keeps them apart at the point where the difference is known.
 *
 * Deliberately a sum rather than a record of results plus missing references:
 * results and missing givens can never both be non-empty, so a record would
 * admit a combination that has to be forbidden by convention.
 *
 * Note that a *given condition* that is not satisfied (an existential condition
 * on the given itself) is `complete` with zero results, not `given-not-found`.
 * The given exists; the specification simply excludes it.
 */
export type ReadResult =
    | { kind: 'complete'; results: ProjectedResult[] }
    | { kind: 'given-not-found'; references: FactReference[] };

export interface Storage {
    close(): Promise<void>;
    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]>;
    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]>;
    /**
     * Evaluate a specification, reporting whether any given fact was absent
     * (issue #232). `read` is the same operation with that distinction
     * discarded; prefer this where the caller can act on the difference.
     */
    readFull(start: FactReference[], specification: Specification): Promise<ReadResult>;
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