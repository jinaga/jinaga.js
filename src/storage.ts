import { Query } from './query/query';
import { Feed } from "./specification/feed";
import { Specification } from "./specification/specification";
import { findIndex } from './util/fn';

export type FactReference = {
    type: string;
    hash: string;
};

export type FactPath = FactReference[];

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
    query(start: FactReference, query: Query): Promise<FactPath[]>;
    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]>;
    feed(feed: Feed, bookmark: string): Promise<FactFeed>;
    whichExist(references: FactReference[]): Promise<FactReference[]>;
    load(references: FactReference[]): Promise<FactRecord[]>;
}

export interface Queue {
    peek(): Promise<FactEnvelope[]>;
    enqueue(envelopes: FactEnvelope[]): Promise<void>;
    dequeue(envelopes: FactEnvelope[]): Promise<void>;
}

export function factReferenceEquals(a: FactReference) {
    return (r: FactReference) => r.hash === a.hash && r.type === a.type;
}

export function uniqueFactReferences(references: FactReference[]): FactReference[] {
    return references.filter((value, index, array) => {
        return findIndex(array, factReferenceEquals(value)) === index;
    });
}
