import { Inverse, invertQuery } from '../query/inverter';
import { Query } from '../query/query';
import { describeSpecification } from '../specification/description';
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactPath, FactRecord, FactReference, ProjectedResult, Storage } from '../storage';
import { computeStringHash } from '../util/encoding';
import { mapAsync } from '../util/fn';
import { Handler, Observable, ObservableSource, ObservableSubscription, SpecificationListener } from './observable';

type Listener = {
    inverse: Inverse,
    match: FactReference,
    added: Handler,
    removed: Handler
};

class SubscriptionImpl implements ObservableSubscription {
    private listeners: Listener[];
    private loading: Promise<void>;

    constructor(
        private observable: ObservableImpl,
        private added: Handler,
        private removed: Handler,
        private results: Promise<FactPath[]>
    ) {
        this.listeners = observable.inverses.map(inverse => {
            return {
                inverse: inverse,
                match: observable.start,
                added: added,
                removed: removed
            }
        });
        this.loading = this.beginLoading();
    }

    add() {
        this.listeners.forEach(listener => {
            this.observable.addListener(listener);
        });
    }

    load() {
        return this.loading;
    }

    dispose() {
        this.listeners.forEach(listener => {
            this.observable.removeListener(listener);
        });
    }

    private async beginLoading() {
        const paths = await this.results;

        if (paths.length > 0) {
            await this.added(paths);
        }
    }
}

class ObservableImpl implements Observable {
    constructor(
        public start: FactReference,
        public query: Query,
        public inverses: Inverse[],
        public results: Promise<FactPath[]>,
        public addListener: (subscription: Listener) => void,
        public removeListener: (subscription: Listener) => void) {}

    subscribe(added: Handler, removed: Handler): ObservableSubscription {
        const subscription = new SubscriptionImpl(this, added, removed, this.results);
        subscription.add();
        return subscription;
    }
}

export class ObservableSourceImpl implements ObservableSource {
    private listenersByTypeAndQuery: {
        [appliedToType: string]: {
            [queryKey: string]: Listener[]
        }
    };
    private listentersByTypeAndSpecification: {
        [appliedToType: string]: {
            [specificationKey: string]: {
                specification: Specification,
                listeners: SpecificationListener[]
            }
        }
    } = {};

    constructor(private inner: Storage) {
        this.listenersByTypeAndQuery = {};
    }

    async close(): Promise<void> {
        await this.inner.close();
    }

    async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        const saved = await this.inner.save(envelopes);
        for (let index = 0; index < saved.length; index++) {
            const envelope = saved[index];
            await this.notifyFactSaved(envelope.fact);
        }
        return saved;
    }
    
    query(start: FactReference, query: Query) {
        return this.inner.query(start, query);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.inner.read(start, specification);
    }

    feed(feed: Feed, bookmark: string): Promise<FactFeed> {
        return this.inner.feed(feed, bookmark);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.inner.whichExist(references);
    }

    load(references: FactReference[]) {
        return this.inner.load(references);
    }

    from(fact: FactReference, query: Query): Observable {
        const inverses = invertQuery(query);
        const observable = new ObservableImpl(fact, query, inverses,
            this.inner.query(fact, query),
            listener => { this.addListener(listener); },
            listener => { this.removeListener(listener); });
        return observable;
    }

    private addListener(listener: Listener) {
        let listenersByQuery = this.listenersByTypeAndQuery[listener.inverse.appliedToType];
        if (!listenersByQuery) {
            listenersByQuery = {};
            this.listenersByTypeAndQuery[listener.inverse.appliedToType] = listenersByQuery;
        }

        const queryKey = listener.inverse.affected.toDescriptiveString();
        let listeners = listenersByQuery[queryKey];
        if (!listeners) {
            listeners = [];
            listenersByQuery[queryKey] = listeners;
        }

        listeners.push(listener);
    }

    private removeListener(listener: Listener) {
        const listenersByQuery = this.listenersByTypeAndQuery[listener.inverse.appliedToType];
        if (listenersByQuery) {
            const queryKey = listener.inverse.affected.toDescriptiveString();
            const listeners = listenersByQuery[queryKey];
            if (listeners) {
                const index = listeners.indexOf(listener);
                if (index >= 0) {
                    listeners.splice(index, 1);
                }
            }
        }
    }

    public addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>): SpecificationListener {
        if (specification.given.length !== 1) {
            throw new Error("Specification must have exactly one given fact");
        }
        const givenType = specification.given[0].type;
        const specificationKey = computeStringHash(describeSpecification(specification, 0));

        let listenersBySpecification = this.listentersByTypeAndSpecification[givenType];
        if (!listenersBySpecification) {
            listenersBySpecification = {};
            this.listentersByTypeAndSpecification[givenType] = listenersBySpecification;
        }

        let listeners = listenersBySpecification[specificationKey];
        if (!listeners) {
            listeners = {
                specification,
                listeners: []
            };
            listenersBySpecification[specificationKey] = listeners;
        }

        const specificationListener = {
            onResult
        };
        listeners.listeners.push(specificationListener);
        return specificationListener;
    }

    public removeSpecificationListener(specificationListener: SpecificationListener) {
        for (const givenType in this.listentersByTypeAndSpecification) {
            const listenersBySpecification = this.listentersByTypeAndSpecification[givenType];
            for (const specificationKey in listenersBySpecification) {
                const listeners = listenersBySpecification[specificationKey];
                const index = listeners.listeners.indexOf(specificationListener);
                if (index >= 0) {
                    listeners.listeners.splice(index, 1);

                    if (listeners.listeners.length === 0) {
                        delete listenersBySpecification[specificationKey];

                        if (Object.keys(listenersBySpecification).length === 0) {
                            delete this.listentersByTypeAndSpecification[givenType];
                        }
                    }
                }
            }
        }
    }

    private async notifyFactSaved(fact: FactRecord) {
        const listenersByQuery = this.listenersByTypeAndQuery[fact.type];
        if (listenersByQuery) {
            for (const queryKey in listenersByQuery) {
                const listeners = listenersByQuery[queryKey];
                if (listeners && listeners.length > 0) {
                    const query = listeners[0].inverse.affected;
                    const affected = await this.inner.query(fact, query);
                    await mapAsync(listeners, async listener => {
                        const matching = affected.filter(path => {
                            const last = path[path.length - 1];
                            return last.hash === listener.match.hash && last.type === listener.match.type;
                        });
                        await mapAsync(matching, async backtrack => {
                            await this.notifyListener([{
                                type: fact.type,
                                hash: fact.hash
                            }].concat(backtrack).reverse().slice(1), listener);
                        })
                    });
                }
            }
        }

        const listenersBySpecification = this.listentersByTypeAndSpecification[fact.type];
        if (listenersBySpecification) {
            for (const specificationKey in listenersBySpecification) {
                const listeners = listenersBySpecification[specificationKey];
                if (listeners && listeners.listeners.length > 0) {
                    const specification = listeners.specification;
                    const givenReference = {
                        type: fact.type,
                        hash: fact.hash
                    };
                    const results = await this.inner.read([givenReference], specification);
                    for (const specificationListener of listeners.listeners) {
                        await specificationListener.onResult(results);
                    }
                }
            }
        }
    }

    private async notifyListener(prefix: FactPath, listener: Listener) {
        const fact = prefix[prefix.length - 1];
        if (listener.inverse.added && listener.added) {
            const added = await this.inner.query(fact, listener.inverse.added);
            if (added.length > 0) {
                const paths = added.map(path => prefix.concat(path));
                listener.added(paths);
            }
        }
        if (listener.inverse.removed && listener.removed) {
            const removed = prefix.slice(0, prefix.length - listener.inverse.removed.getPathLength());
            if (removed.length > 0) {
                listener.removed([removed]);
            }
        }
    }
}