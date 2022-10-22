import { Hydration } from '../fact/hydrate';
import { ObservableSource, ObservableSubscription } from '../observable/observable';
import { Query } from '../query/query';
import { Preposition } from '../query/query-parser';
import { FactPath, FactReference, uniqueFactReferences } from '../storage';
import { ModelMap } from './model-map';
import { Watch } from './watch';
import { mapAsync } from '../util/fn';
import { Trace } from '../util/trace';

interface WatchChild {
    load(): Promise<void>;
    stop(): void;
}

export class WatchImpl<Fact, Model> implements Watch<Fact, Model>, WatchChild {
    private subscription: ObservableSubscription | undefined;
    private modelMap = new ModelMap<Model>();
    private children: WatchChild[] = [];

    constructor(
        private start: FactReference,
        private query: Query,
        private resultAdded: (path: FactPath, result: Fact, take: ((model: Model | null) => void)) => void,
        private resultRemoved: ((model: Model) => void) | undefined,
        private inner: ObservableSource
    ) {}

    begin() {
        this.subscription = this.inner.from(this.start, this.query)
            .subscribe(async paths => {
                try {
                    await this.onAdded(paths);
                }
                catch (reason) {
                    this.onError(reason);
                }
            }, async reference => {
                this.onRemoved(reference);
            });
    }

    watch<U, V>(
        preposition: Preposition<Fact, U>,
        resultAdded: (parent: Model, result: U) => V,
        resultRemoved: (model: V) => void) : Watch<U, V>;
    watch<U, V>(
        preposition: Preposition<Fact, U>,
        resultAdded: (parent: Model, result: U) => void) : Watch<U, V>;
    watch<U, V>(
        preposition: Preposition<Fact, U>,
        resultAdded: (parent: Model, result: U) => (V | void),
        resultRemoved?: (model: V) => void
    ) : Watch<U, V> {
        const query = new Query(preposition.steps);
        const fullQuery = this.query.concat(query);
        const onResultAdded = (path: FactPath, fact: U, take: ((model: V | null) => void)) => {
            const prefix = path.slice(0, this.query.getPathLength());
            this.modelMap.withModel(prefix, (parent: Model) => {
                const model = resultAdded(parent, fact);
                take(resultRemoved ? <V>model : null);
            });
        }
        const watch = new WatchImpl<U, V>(this.start, fullQuery, onResultAdded, resultRemoved, this.inner);
        watch.begin();
        this.children.push(watch);
        return watch;
    }

    async load() {
        await this.subscription?.load();
        await mapAsync(this.children, child => child.load());
    }

    stop() {
        this.subscription?.dispose();
        this.children.forEach(child => child.stop());
    }

    private async onAdded(paths: FactPath[]) {
        const references = paths.map(path => path[path.length - 1]);
        const uniqueReferences = uniqueFactReferences(references);
        const records = await this.inner.load(uniqueReferences);
        const hydration = new Hydration(records);
        paths.forEach(path => {
            if (!this.modelMap.hasModel(path)) {
                const factReference = path[path.length - 1];
                try {
                    const fact = <Fact>hydration.hydrate(factReference);
                    this.resultAdded(path, fact, (model: Model | null) => {
                        if (model) {
                            this.modelMap.setModel(path, model);
                        }
                    });
                }
                catch (x) {
                    // Log and continue.
                    Trace.error(x);
                }
            }
        });
    }

    private onRemoved(paths: FactPath[]) {
        paths.forEach(path => {
            if (this.modelMap.hasModel(path)) {
                const model = this.modelMap.removeModel(path);
                if (this.resultRemoved && model) {
                    this.resultRemoved(model);
                }
            }
        });
    }

    private onError(reason: any) {
        throw new Error(reason);
    }
}
