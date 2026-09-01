import { FactManager } from "../managers/factManager";
import { SpecificationListener } from "../observable/observable";
import { SpecificationInverse, invertSpecification } from "../specification/inverse";
import { Specification } from "../specification/specification";
import { FactReference, ProjectedResult, ReferencesByName, computeTupleSubsetHash } from "../storage";
import { Trace } from "../util/trace";

/**
 * One row that entered or left a specification's result set.
 *
 * `row` holds the fact references the row is made of, keyed by the label
 * names of the specification's given and its matches. `rowHash` identifies
 * the row: it is stable across the add and the remove of the same row, so a
 * consumer can pair them, deduplicate repeats, and record progress against
 * it.
 */
export interface SpecificationChange {
    row: ReferencesByName;
    rowHash: string;
}

/**
 * Callbacks for {@link Jinaga.observeChanges}. Provide at least one.
 *
 * Both are dispatched through `ObservableSource.notifyListener`, so they
 * inherit the bound added in #249: a callback that exceeds
 * `listenerTimeoutMs` is abandoned and the save proceeds. That is intended
 * behavior for this seam rather than a caveat — see the note on
 * `observeChanges` about a notification being a hint rather than a record.
 */
export interface SpecificationChangeHandlers {
    onAdded?: (changes: SpecificationChange[]) => Promise<void>;
    onRemoved?: (changes: SpecificationChange[]) => Promise<void>;
}

/**
 * A running change observation. Call `stop` to release its listeners.
 */
export interface ChangeSubscription {
    stop(): void;
}

class ChangeObserver implements ChangeSubscription {
    /**
     * The labels that identify a row: the given, then each match's unknown.
     * Every root-path inverse carries exactly this set as its `resultSubset`,
     * on the add and the remove side alike, which is what lets one row hash
     * pair the two.
     */
    private readonly rowIdentityLabels: string[];
    private readonly givenHash: string;
    private listeners: SpecificationListener[] = [];
    private stopped = false;

    constructor(
        private readonly factManager: FactManager,
        private readonly specification: Specification,
        given: FactReference[],
        private readonly handlers: SpecificationChangeHandlers
    ) {
        this.rowIdentityLabels = [
            ...specification.given.map(g => g.label.name),
            ...specification.matches.map(m => m.unknown.name)
        ];

        const givenSubset = specification.given.map(g => g.label.name);
        const tuple: ReferencesByName = specification.given.reduce((t, label, index) => ({
            ...t,
            [label.label.name]: given[index]
        }), {} as ReferencesByName);
        this.givenHash = computeTupleSubsetHash(tuple, givenSubset);
    }

    public start() {
        // Only root-path inverses are registered. An inverse with a non-empty
        // path belongs to a nested specification inside a projection, and this
        // seam delivers no nested rows: a change within a child collection does
        // not add or remove a row from the top-level set. Registering those
        // would deliver rows the caller never asked for, keyed by labels it
        // does not know.
        const inverses = invertSpecification(this.specification)
            .filter(inverse => inverse.path === "");

        Trace.info(`[ChangeObserver] START - Root inverses: ${inverses.length}, Given hash: ${this.givenHash.substring(0, 8)}...`);

        this.listeners = inverses.map(inverse => this.factManager.addSpecificationListener(
            inverse.inverseSpecification,
            results => this.onResult(inverse, results)
        ));
    }

    public stop() {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        for (const listener of this.listeners) {
            this.factManager.removeSpecificationListener(listener);
        }
        this.listeners = [];
        Trace.info(`[ChangeObserver] STOPPED - Given hash: ${this.givenHash.substring(0, 8)}...`);
    }

    private async onResult(inverse: SpecificationInverse, results: ProjectedResult[]): Promise<void> {
        if (this.stopped) {
            return;
        }

        const handler = inverse.operation === "add"
            ? this.handlers.onAdded
            : this.handlers.onRemoved;
        if (!handler) {
            return;
        }

        // Keep only the rows that descend from this observation's given. One
        // inverse specification is shared by every observer of the same shape,
        // so a notification arrives for all of them and each filters to its own.
        const matching = results.filter(pr =>
            this.givenHash === computeTupleSubsetHash(pr.tuple, inverse.givenSubset));
        if (matching.length === 0) {
            return;
        }

        const changes = this.toChanges(matching);
        if (changes.length === 0) {
            return;
        }

        Trace.info(`[ChangeObserver] ${inverse.operation.toUpperCase()} - Rows: ${changes.length}`);
        await handler(changes);
    }

    /**
     * Narrow each result to the row identity labels, dropping the projection
     * and any extra labels the inverse carries. A remove inverse's tuple names
     * the fact whose arrival retracted the row; that label is absent from the
     * add side, so hashing the whole tuple would give the same row two
     * different hashes and a consumer could never pair them.
     *
     * Repeats within one batch are collapsed. Repeats ACROSS batches are not:
     * holding a delivered-row set would reintroduce exactly the unbounded
     * growth this seam exists to avoid. `rowHash` is what a consumer
     * deduplicates on, which is why it is in the payload.
     */
    private toChanges(results: ProjectedResult[]): SpecificationChange[] {
        const changes: SpecificationChange[] = [];
        const seen = new Set<string>();
        for (const pr of results) {
            const rowHash = computeTupleSubsetHash(pr.tuple, this.rowIdentityLabels);
            if (seen.has(rowHash)) {
                continue;
            }
            seen.add(rowHash);
            const row: ReferencesByName = {};
            for (const label of this.rowIdentityLabels) {
                if (pr.tuple[label] !== undefined) {
                    row[label] = pr.tuple[label];
                }
            }
            changes.push({ row, rowHash });
        }
        return changes;
    }
}

export function startChangeObserver(
    factManager: FactManager,
    specification: Specification,
    given: FactReference[],
    handlers: SpecificationChangeHandlers
): ChangeSubscription {
    const observer = new ChangeObserver(factManager, specification, given, handlers);
    observer.start();
    return observer;
}
