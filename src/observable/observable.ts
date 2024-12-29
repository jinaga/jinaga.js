import { describeSpecification } from '../specification/description';
import { Specification } from "../specification/specification";
import { FactEnvelope, FactRecord, ProjectedResult, Storage } from '../storage';
import { computeStringHash } from '../util/encoding';

export interface SpecificationListener {
    onResult(results: ProjectedResult[]): Promise<void>;
}

export class ObservableSource {
    private listenersByTypeAndSpecification: Map<string, Map<string, {
        specification: Specification,
        listeners: SpecificationListener[]
    }>> = new Map();

    constructor(private store: Storage) {
    }

    async notify(saved: FactEnvelope[]): Promise<void> {
        for (let index = 0; index < saved.length; index++) {
            const envelope = saved[index];
            await this.notifyFactSaved(envelope.fact);
        }
    }

    public addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>): SpecificationListener {
        if (specification.given.length !== 1) {
            throw new Error("Specification must have exactly one given fact");
        }
        const givenType = specification.given[0].type;
        const specificationKey = computeStringHash(describeSpecification(specification, 0));

        let listenersBySpecification = this.listenersByTypeAndSpecification.get(givenType);
        if (!listenersBySpecification) {
            listenersBySpecification = new Map();
            this.listenersByTypeAndSpecification.set(givenType, listenersBySpecification);
        }

        let listeners = listenersBySpecification.get(specificationKey);
        if (!listeners) {
            listeners = {
                specification,
                listeners: []
            };
            listenersBySpecification.set(specificationKey, listeners);
        }

        const specificationListener = {
            onResult
        };
        listeners.listeners.push(specificationListener);
        return specificationListener;
    }

    public removeSpecificationListener(specificationListener: SpecificationListener) {
        for (const [givenType, listenersBySpecification] of this.listenersByTypeAndSpecification) {
            for (const [specificationKey, listeners] of listenersBySpecification) {
                const index = listeners.listeners.indexOf(specificationListener);
                if (index >= 0) {
                    listeners.listeners.splice(index, 1);

                    if (listeners.listeners.length === 0) {
                        listenersBySpecification.delete(specificationKey);

                        if (Object.keys(listenersBySpecification).length === 0) {
                            this.listenersByTypeAndSpecification.delete(givenType);
                        }
                    }
                }
            }
        }
    }

    private async notifyFactSaved(fact: FactRecord) {
        const listenersBySpecification = this.listenersByTypeAndSpecification.get(fact.type);
        if (listenersBySpecification) {
            for (const [specificationKey, listeners] of listenersBySpecification) {
                if (listeners && listeners.listeners.length > 0) {
                    const specification = listeners.specification;
                    const givenReference = {
                        type: fact.type,
                        hash: fact.hash
                    };
                    const results = await this.store.read([givenReference], specification);
                    for (const specificationListener of listeners.listeners) {
                        await specificationListener.onResult(results);
                    }
                }
            }
        }
    }
}