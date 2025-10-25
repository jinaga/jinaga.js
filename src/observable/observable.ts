import { describeSpecification } from '../specification/description';
import { Specification } from "../specification/specification";
import { FactEnvelope, FactRecord, ProjectedResult, Storage } from '../storage';
import { computeStringHash } from '../util/encoding';
import { Trace } from '../util/trace';

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
        const givenType = specification.given[0].label.type;
        const givenName = specification.given[0].label.name;
        const specificationKey = computeStringHash(describeSpecification(specification, 0));
        const hasNestedSpecs = specification.projection.type === "composite" &&
            specification.projection.components.some(c => c.type === "specification");

        Trace.info(`[ObservableSource] ADD_LISTENER REQUEST - Type: ${givenType}, Name: ${givenName}, Spec key: ${specificationKey.substring(0, 8)}..., Has nested specs: ${hasNestedSpecs}`);

        let listenersBySpecification = this.listenersByTypeAndSpecification.get(givenType);
        if (!listenersBySpecification) {
            listenersBySpecification = new Map();
            this.listenersByTypeAndSpecification.set(givenType, listenersBySpecification);
            Trace.info(`[ObservableSource] Created new listener map for type: ${givenType}`);
        }

        let listeners = listenersBySpecification.get(specificationKey);
        if (!listeners) {
            listeners = {
                specification,
                listeners: []
            };
            listenersBySpecification.set(specificationKey, listeners);
            Trace.info(`[ObservableSource] Created new listener group for spec: ${specificationKey.substring(0, 8)}... (type: ${givenType})`);
        }

        const specificationListener = {
            onResult
        };
        listeners.listeners.push(specificationListener);
        
        const listenerCount = listeners.listeners.length;
        const totalListeners = Array.from(this.listenersByTypeAndSpecification.values())
            .reduce((total, map) => total + Array.from(map.values()).reduce((sum, l) => sum + l.listeners.length, 0), 0);
        
        Trace.info(`[ObservableSource] LISTENER ADDED - Spec: ${specificationKey.substring(0, 8)}..., Type: ${givenType}, Count for spec: ${listenerCount}, Total listeners: ${totalListeners}, Nested specs: ${hasNestedSpecs}`);
        
        return specificationListener;
    }

    public removeSpecificationListener(specificationListener: SpecificationListener) {
        const startTime = Date.now();
        let found = false;
        let removedFromSpec = '';
        let removedFromType = '';
        
        for (const [givenType, listenersBySpecification] of this.listenersByTypeAndSpecification) {
            for (const [specificationKey, listeners] of listenersBySpecification) {
                const beforeCount = listeners.listeners.length;
                const index = listeners.listeners.indexOf(specificationListener);
                if (index >= 0) {
                    Trace.info(`[ObservableSource] REMOVING listener - Spec: ${specificationKey.substring(0, 8)}..., Type: ${givenType}, Index: ${index}, Before count: ${beforeCount}`);
                    
                    listeners.listeners.splice(index, 1);
                    found = true;
                    removedFromSpec = specificationKey;
                    removedFromType = givenType;
                    
                    const afterCount = listeners.listeners.length;
                    Trace.info(`[ObservableSource] REMOVED listener - After count: ${afterCount}`);

                    if (listeners.listeners.length === 0) {
                        listenersBySpecification.delete(specificationKey);
                        Trace.info(`[ObservableSource] Deleted empty spec group: ${specificationKey.substring(0, 8)}...`);

                        if (listenersBySpecification.size === 0) {
                            this.listenersByTypeAndSpecification.delete(givenType);
                            Trace.info(`[ObservableSource] Deleted empty type group: ${givenType}`);
                        }
                    }
                    break;
                }
            }
            if (found) break;
        }
        
        const totalListeners = Array.from(this.listenersByTypeAndSpecification.values())
            .reduce((total, map) => total + Array.from(map.values()).reduce((sum, l) => sum + l.listeners.length, 0), 0);
        
        const duration = Date.now() - startTime;
        if (found) {
            Trace.info(`[ObservableSource] Listener removal completed - Spec: ${removedFromSpec.substring(0, 8)}..., Type: ${removedFromType}, Total remaining: ${totalListeners}, Duration: ${duration}ms`);
        } else {
            Trace.warn(`[ObservableSource] Listener NOT FOUND during removal - Total listeners: ${totalListeners}, Duration: ${duration}ms`);
        }
    }

    private async notifyFactSaved(fact: FactRecord) {
        const startTime = Date.now();
        const listenersBySpecification = this.listenersByTypeAndSpecification.get(fact.type);
        
        if (listenersBySpecification) {
            Trace.info(`[ObservableSource] NOTIFY START - Fact type: ${fact.type}, Hash: ${fact.hash.substring(0, 8)}..., Spec groups: ${listenersBySpecification.size}`);
            
            let totalNotifications = 0;
            let specCount = 0;
            let nestedSpecCount = 0;
            
            for (const [specificationKey, listeners] of listenersBySpecification) {
                specCount++;
                if (listeners && listeners.listeners.length > 0) {
                    const listenerCount = listeners.listeners.length;
                    const specification = listeners.specification;
                    const hasNestedSpecs = specification.projection.type === "composite" &&
                        specification.projection.components.some(c => c.type === "specification");
                    
                    if (hasNestedSpecs) {
                        nestedSpecCount++;
                        const nestedSpecNames = specification.projection.type === "composite"
                            ? specification.projection.components
                                .filter(c => c.type === "specification")
                                .map(c => c.name)
                                .join(', ')
                            : '';
                        Trace.info(`[ObservableSource] NESTED SPEC DETECTED - Spec ${specCount}/${listenersBySpecification.size}, Key: ${specificationKey.substring(0, 8)}..., Nested components: [${nestedSpecNames}], Listeners: ${listenerCount}`);
                    } else {
                        Trace.info(`[ObservableSource] Processing spec ${specCount}/${listenersBySpecification.size} - Key: ${specificationKey.substring(0, 8)}..., Listeners: ${listenerCount}`);
                    }
                    
                    const givenReference = {
                        type: fact.type,
                        hash: fact.hash
                    };
                    
                    const readStart = Date.now();
                    const results = await this.store.read([givenReference], specification);
                    const readDuration = Date.now() - readStart;
                    
                    if (hasNestedSpecs) {
                        Trace.info(`[ObservableSource] Store read for NESTED spec - Results: ${results.length}, Duration: ${readDuration}ms`);
                        // Log nested result structure if present
                        if (results.length > 0 && specification.projection.type === "composite") {
                            const nestedResults = specification.projection.components
                                .filter(c => c.type === "specification")
                                .map(c => `${c.name}: ${results[0].result[c.name]?.length || 0}`)
                                .join(', ');
                            Trace.info(`[ObservableSource] Nested results structure: {${nestedResults}}`);
                        }
                    } else {
                        Trace.info(`[ObservableSource] Store read completed - Results: ${results.length}, Duration: ${readDuration}ms`);
                    }
                    
                    // Create a snapshot of listeners to avoid modification during iteration
                    const listenerSnapshot = [...listeners.listeners];
                    if (listenerSnapshot.length !== listeners.listeners.length) {
                        Trace.warn(`[ObservableSource] RACE CONDITION DETECTED - Listener count changed during snapshot: ${listenerSnapshot.length} vs ${listeners.listeners.length}`);
                    }
                    
                    for (let i = 0; i < listenerSnapshot.length; i++) {
                        const specificationListener = listenerSnapshot[i];
                        if (specificationListener) {
                            try {
                                const notifyStart = Date.now();
                                Trace.info(`[ObservableSource] Calling listener ${i+1}/${listenerSnapshot.length} - Nested: ${hasNestedSpecs}`);
                                await specificationListener.onResult(results);
                                const notifyDuration = Date.now() - notifyStart;
                                totalNotifications++;
                                
                                if (notifyDuration > 100) {
                                    Trace.warn(`[ObservableSource] SLOW notification - Listener ${i+1}/${listenerSnapshot.length}, Duration: ${notifyDuration}ms, Nested: ${hasNestedSpecs}`);
                                } else {
                                    Trace.info(`[ObservableSource] Listener completed - ${i+1}/${listenerSnapshot.length}, Duration: ${notifyDuration}ms`);
                                }
                            } catch (error) {
                                Trace.error(`[ObservableSource] ERROR in listener notification - Listener ${i+1}/${listenerSnapshot.length}, Nested: ${hasNestedSpecs}, Error: ${error}`);
                            }
                        } else {
                            Trace.warn(`[ObservableSource] NULL listener encountered at index ${i}`);
                        }
                    }
                } else {
                    Trace.info(`[ObservableSource] Skipping spec ${specCount}/${listenersBySpecification.size} - No listeners or null group`);
                }
            }
            
            const totalDuration = Date.now() - startTime;
            Trace.info(`[ObservableSource] NOTIFY COMPLETE - Fact: ${fact.hash.substring(0, 8)}..., Type: ${fact.type}, Specs processed: ${specCount} (${nestedSpecCount} nested), Total notifications: ${totalNotifications}, Duration: ${totalDuration}ms`);
        } else {
            Trace.info(`[ObservableSource] No listeners for fact type: ${fact.type} - Available types: [${Array.from(this.listenersByTypeAndSpecification.keys()).join(', ')}]`);
        }
    }
}