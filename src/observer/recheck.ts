import { pinLabel } from "../specification/inverse-candidates";
import { SpecificationRow } from "../specification/row";
import { PathCondition, Specification } from "../specification/specification";

/**
 * One row's transition across the boundary of a specification's result set.
 */
export interface RecheckDecision<U> {
    operation: "added" | "removed";
    row: SpecificationRow<U>;
}

/**
 * Decide which candidate rows changed, by reading the result rather than by
 * trusting the inverse that proposed them.
 *
 * An inverse produces *candidates*: rows whose membership may have changed.
 * It carries no add or remove label, and a candidate may be an addition, a
 * removal, or no change at all. What decides is `present`, a read of the
 * specification for this subscription's givens on the store that holds the
 * whole batch.
 *
 * `held` is the set a consumer has been offered and has not had withdrawn,
 * keyed by `rowHash`. Each candidate is kept exactly when `present` has it,
 * and **every row that is not a candidate is left exactly as it was** — that
 * is what makes the order of the facts in one batch immaterial, since each
 * fact's re-check touches only its own candidates and the reads all see the
 * same graph. A transition is reported only when the two sides disagree, so a
 * row the consumer already holds is never offered twice and a row it was
 * never offered is never withdrawn.
 *
 * `held` is updated in place, and the decisions are returned in candidate
 * order so one caller can emit them in the order it decided them.
 *
 * jinaga/jinaga-spec#12 proves this loop exact for a sequence of fresh
 * batches (`maintain_correct`, `recheck_each`, `stream_correct`), given
 * candidates that cover every changed row — which `candidateInverses`
 * supplies.
 */
export function recheckCandidates<U>(
    held: Map<string, SpecificationRow<U>>,
    candidates: Iterable<SpecificationRow<U>>,
    present: Map<string, SpecificationRow<U>>
): RecheckDecision<U>[] {
    const decisions: RecheckDecision<U>[] = [];
    const decided = new Set<string>();
    for (const candidate of candidates) {
        if (decided.has(candidate.rowHash)) {
            continue;
        }
        decided.add(candidate.rowHash);
        const inResult = present.get(candidate.rowHash);
        const wasHeld = held.get(candidate.rowHash);
        if (inResult !== undefined && wasHeld === undefined) {
            held.set(candidate.rowHash, inResult);
            decisions.push({ operation: "added", row: inResult });
        }
        else if (inResult === undefined && wasHeld !== undefined) {
            held.delete(candidate.rowHash);
            decisions.push({ operation: "removed", row: wasHeld });
        }
    }
    return decisions;
}

/**
 * An inverse that fires when the specification's own given at `index` is
 * saved, and whose rows are every row of the specification.
 *
 * `candidateInverses` pins unknowns, and a given is not an unknown, so no
 * inverse it builds waits for a given's type. That matters because
 * `SpecificationRunner.read` returns nothing at all while any given fact is
 * absent from the store: a subscription started on a given that has not
 * arrived yet holds no rows, and the moment that fact arrives every row of
 * the specification appears at once. This inverse is how the subscription
 * hears about it, and the re-check above then decides each row.
 *
 * The pin is bound through an unknown equal to both the new fact and the
 * given, so a fact of the given's type that is *not* this subscription's
 * given produces no solution. The read then stops at that first match instead
 * of evaluating the specification, which is what keeps a listener on a common
 * given type — a user, a tenant — from reading the whole result on every
 * unrelated fact of that type.
 */
export function givenCandidateInverse(specification: Specification, index: number): Specification {
    const given = specification.given[index];
    const sameFactAs = (labelRight: string): PathCondition => ({
        type: "path",
        rolesLeft: [],
        labelRight,
        rolesRight: []
    });
    return {
        given: [
            ...specification.given,
            { label: { name: pinLabel, type: given.label.type }, conditions: [] }
        ],
        matches: [
            {
                unknown: { name: `${pinLabel}given${index}`, type: given.label.type },
                conditions: [sameFactAs(pinLabel), sameFactAs(given.label.name)]
            },
            ...specification.matches
        ],
        projection: specification.projection
    };
}
