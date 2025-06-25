import { TopologicalSorter } from '../fact/sorter';
import { WebClient } from '../http/web-client';
import { QueueProcessor, Saver } from '../managers/QueueProcessor';
import { FactEnvelope, factEnvelopeEquals, FactRecord, FactReference, Storage } from '../storage';
import { Trace } from "../util/trace";
import { Fork } from "./fork";
import { serializeLoad } from './serialize';

/**
 * In-memory queue for TransientFork to batch operations
 */
class MemoryQueue {
    private envelopes: FactEnvelope[] = [];

    async enqueue(envelopes: FactEnvelope[]): Promise<void> {
        this.envelopes.push(...envelopes);
        Trace.info(`MemoryQueue: Enqueued ${envelopes.length} envelopes, total queued: ${this.envelopes.length}`);
    }

    async peek(): Promise<FactEnvelope[]> {
        return [...this.envelopes];
    }

    async dequeue(envelopes: FactEnvelope[]): Promise<void> {
        // Remove the processed envelopes from the queue
        for (const envelope of envelopes) {
            const index = this.envelopes.findIndex(e => factEnvelopeEquals(envelope.fact)(e));
            if (index >= 0) {
                this.envelopes.splice(index, 1);
            }
        }
        Trace.info(`MemoryQueue: Dequeued ${envelopes.length} envelopes, remaining: ${this.envelopes.length}`);
    }
}

/**
 * Saver implementation for TransientFork that uses WebClient
 */
class TransientSaver implements Saver {
    constructor(
        private readonly client: WebClient,
        private readonly queue: MemoryQueue
    ) {}

    async save(): Promise<void> {
        const envelopes = await this.queue.peek();
        if (envelopes.length > 0) {
            Trace.info(`TransientSaver: Processing ${envelopes.length} envelopes from memory queue`);
            try {
                const startTime = Date.now();
                await this.client.saveWithRetry(envelopes);
                const duration = Date.now() - startTime;
                Trace.info(`TransientSaver: Successfully saved ${envelopes.length} envelopes in ${duration}ms`);
                await this.queue.dequeue(envelopes);
            } catch (error) {
                Trace.error(`TransientSaver: Failed to save ${envelopes.length} envelopes: ${error}`);
                throw error;
            }
        } else {
            Trace.info(`TransientSaver: No envelopes in memory queue to process`);
        }
    }
}

export class TransientFork implements Fork {
    private memoryQueue: MemoryQueue;
    private queueProcessor: QueueProcessor;

    constructor(
        private storage: Storage,
        private client: WebClient,
        private queueProcessingDelayMs: number = 100
    ) {
        this.memoryQueue = new MemoryQueue();
        const saver = new TransientSaver(this.client, this.memoryQueue);
        this.queueProcessor = new QueueProcessor(saver, queueProcessingDelayMs);
        
        Trace.info(`TransientFork: Initialized with memory queue and ${queueProcessingDelayMs}ms processing delay`);
    }

    close() {
        this.queueProcessor.dispose();
        return Promise.resolve();
    }

    async save(envelopes: FactEnvelope[]): Promise<void> {
        Trace.info(`TransientFork: Queueing ${envelopes.length} envelopes for batched processing`);
        await this.memoryQueue.enqueue(envelopes);
        this.queueProcessor.scheduleProcessing();
    }

    async load(references: FactReference[]): Promise<FactEnvelope[]> {
        const known = await this.storage.load(references);
        const remaining = references.filter(reference => !known.some(factEnvelopeEquals(reference)));
        if (remaining.length === 0) {
            return known;
        }
        else {
            const records = await this.loadEnvelopes(remaining);
            return records.concat(known);
        }
    }

    private async loadEnvelopes(references: FactReference[]) {
        const sorter = new TopologicalSorter<FactRecord>();
        let loaded: FactEnvelope[] = [];
        Trace.info(`TransientFork: Loading ${references.length} fact references in chunks of 300`);
        
        for (let start = 0; start < references.length; start += 300) {
            const chunk = references.slice(start, start + 300);
            const chunkNum = Math.floor(start / 300) + 1;
            const totalChunks = Math.ceil(references.length / 300);
            
            Trace.info(`TransientFork: Loading chunk ${chunkNum}/${totalChunks} (${chunk.length} references)`);
            const startTime = Date.now();
            
            try {
                const response = await this.client.load(serializeLoad(chunk));
                const loadDuration = Date.now() - startTime;
                
                const facts = sorter.sort(response.facts, (p, f) => f);
                const envelopes = facts.map(fact => {
                    return <FactEnvelope>{
                        fact: fact,
                        signatures: []
                    };
                });
                
                const saved = await this.storage.save(envelopes);
                const totalDuration = Date.now() - startTime;
                
                if (saved.length > 0) {
                    Trace.counter("facts_saved", saved.length);
                }
                
                Trace.info(`TransientFork: Chunk ${chunkNum}/${totalChunks} completed - Load: ${loadDuration}ms, Total: ${totalDuration}ms, Facts: ${facts.length}, Saved: ${saved.length}`);
                loaded = loaded.concat(envelopes);
            } catch (error) {
                const duration = Date.now() - startTime;
                Trace.error(`TransientFork: Chunk ${chunkNum}/${totalChunks} failed after ${duration}ms: ${error}`);
                throw error;
            }
        }
        
        Trace.info(`TransientFork: Completed loading ${loaded.length} total envelopes`);
        return loaded;
    }

    processQueueNow(): Promise<void> {
        Trace.info(`TransientFork: Processing queue immediately`);
        return this.queueProcessor.processQueueNow();
    }
}