import { ProjectedResult, computeTupleSubsetHash } from "../storage";
import { extractResult } from "./results";
import { Specification } from "./specification";

/**
 * One row of a specification's result set, carrying both what the caller
 * asked for and what identifies the row.
 *
 * `result` is the specification's own projection, exactly as `query` returns
 * it: hydrated facts by default, or whatever the specification selects. A
 * consumer that wants a fact's hash projects one.
 *
 * `rowHash` identifies the row itself rather than any one fact in it. It is
 * stable across the two ways a row is discovered — a read of the current set
 * and a notification that the set changed — and across the add and the remove
 * of the same row, so one key deduplicates every path.
 */
export interface SpecificationRow<U> {
    result: U;
    rowHash: string;
}

/**
 * The labels that identify a row: the given, then each match's unknown.
 *
 * A read of the specification and every root-path inverse of it carry exactly
 * this set of labels, which is what lets one hash identify a row no matter
 * which path found it. Deliberately not the whole tuple: a remove inverse's
 * tuple also names the fact whose arrival retracted the row, and the add side
 * has no label for it.
 */
export function rowIdentityLabels(specification: Specification): string[] {
    return [
        ...specification.given.map(g => g.label.name),
        ...specification.matches.map(m => m.unknown.name)
    ];
}

export function toRow<U>(projectedResult: ProjectedResult, specification: Specification, labels: string[]): SpecificationRow<U> {
    return {
        result: extractResult(projectedResult.result, specification.projection).result,
        rowHash: computeTupleSubsetHash(projectedResult.tuple, labels)
    };
}
