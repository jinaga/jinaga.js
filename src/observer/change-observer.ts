import { FactManager } from "../managers/factManager";
import { SpecificationListener } from "../observable/observable";
import { SpecificationInverse, invertSpecification } from "../specification/inverse";
import { SpecificationRow, rowIdentityLabels, toRow } from "../specification/row";
import { Specification } from "../specification/specification";
import { FactReference, ProjectedResult, ReferencesByName, computeTupleSubsetHash } from "../storage";
import { Trace } from "../util/trace";

/**
 * Callbacks for {@link Jinaga.observeChanges}. Provide at least one.
 *
 * Each callback receives {@link SpecificationRow}s: the specification's own
 * projection, hydrated exactly as `query` and `queryRows` deliver it, together
 * with the row hash that identifies the row.
 *
 * Both are dispatched through `ObservableSource.notifyListener`, so they
 * inherit the bound added in #249: a callback that exceeds
 * `listenerTimeoutMs` is abandoned and the save proceeds. Do the work outside
 * the callback and return promptly. A callback that queries or saves facts
 * re-enters `ObservableSource.notify` from inside its own notification, which
 * is reported as `observable_notify_reentrant`.
 */
export interface SpecificationChangeHandlers<U> {
    onAdded?: (rows: SpecificationRow<U>[]) => Promise<void>;
    onRemoved?: (rows: SpecificationRow<U>[]) => Promise<void>;
}

/**
 * A running change observation. Call `stop` to release its listeners.
 */
export interface ChangeSubscription {
    stop(): void;
}

class ChangeObserver<U> implements ChangeSubscription {
    private readonly rowIdentityLabels: string[];
    private readonly givenHash: string;
    private listeners: SpecificationListener[] = [];
    private stopped = false;

    constructor(
        private readonly factManager: FactManager,
        private readonly specification: Specification,
        given: FactReference[],
        private readonly handlers: SpecificationChangeHandlers<U>
    ) {
        this.rowIdentityLabels = rowIdentityLabels(specification);

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
        // would deliver rows the caller never asked for.
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

        const rows = this.toRows(matching);
        if (rows.length === 0) {
            return;
        }

        Trace.info(`[ChangeObserver] ${inverse.operation.toUpperCase()} - Rows: ${rows.length}`);
        await handler(rows);
    }

    /**
     * Identify each result by the row identity labels and project it exactly
     * as `query` would.
     *
     * The identity is narrowed rather than taken from the whole tuple: a
     * remove inverse's tuple names the fact whose arrival retracted the row,
     * that label is absent from the add side, and hashing the whole tuple
     * would therefore give one row two different hashes.
     *
     * Repeats within one batch are collapsed. Repeats ACROSS batches are not:
     * holding a delivered-row set would reintroduce exactly the unbounded
     * growth this seam exists to avoid. `rowHash` is what a consumer
     * deduplicates on, which is why it is in the payload.
     */
    private toRows(results: ProjectedResult[]): SpecificationRow<U>[] {
        const rows: SpecificationRow<U>[] = [];
        const seen = new Set<string>();
        for (const pr of results) {
            const row = toRow<U>(pr, this.specification, this.rowIdentityLabels);
            if (seen.has(row.rowHash)) {
                continue;
            }
            seen.add(row.rowHash);
            rows.push(row);
        }
        return rows;
    }
}

export function startChangeObserver<U>(
    factManager: FactManager,
    specification: Specification,
    given: FactReference[],
    handlers: SpecificationChangeHandlers<U>
): ChangeSubscription {
    const observer = new ChangeObserver<U>(factManager, specification, given, handlers);
    observer.start();
    return observer;
}
