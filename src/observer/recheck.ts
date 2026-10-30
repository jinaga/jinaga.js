import { pinLabel } from "../specification/inverse-candidates";
import { Label, PathCondition, Specification } from "../specification/specification";
import { FactReference, ReferencesByName } from "../storage";

/**
 * An inverse that fires when the specification's own given at `index` is
 * saved, and whose rows are every row of the specification.
 *
 * Both consumers still need this one. `exactInverses` pins unknowns too, so the
 * given case is outside what it reports, and each consumer answers this inverse
 * with a read of its whole result rather than with a report per row: the
 * observer per level (#376), the row stream over every branch (#377).
 *
 * Every inverse of an unknown pins unknowns, and a given is not an unknown, so
 * none of them waits for a given's type. That matters because
 * `SpecificationRunner.read` returns nothing at all while any given fact is
 * absent from the store: a subscription started on a given that has not
 * arrived yet holds no rows, and the moment that fact arrives every row of
 * the specification appears at once. This inverse is how the subscription
 * hears about it, and the whole-result read it triggers is an answer about
 * every row at once — each row read is an add, and each row held but not read
 * is a remove.
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

/**
 * The references a membership read starts from: the subscription's own givens,
 * then the fact each pinned label binds.
 *
 * Read by the row stream's intersected remove path alone. The observer stopped
 * reading membership in #376, and the row stream stopped for every other
 * report in #377; what is left is the one case the remove direction is not
 * proven for, which `RowObserver.decideRemovePath` states.
 *
 * `null` when the candidate does not bind one of them, or binds it to a fact of
 * another type. An inverse of an unknown binds every match unknown of its
 * level, and binds each to a fact the store reached by a role walk of that
 * unknown's type, so neither arises for one. A caller that reads a candidate
 * from somewhere else gets `null` rather than a membership read whose answer
 * would be about a different tuple, and reads the whole result instead.
 */
export function membershipStart(
    given: FactReference[],
    pinned: Label[],
    references: ReferencesByName
): FactReference[] | null {
    const pinnedReferences: FactReference[] = [];
    for (const label of pinned) {
        const reference = references[label.name];
        if (reference === undefined || reference.type !== label.type) {
            return null;
        }
        pinnedReferences.push(reference);
    }
    return [...given, ...pinnedReferences];
}
