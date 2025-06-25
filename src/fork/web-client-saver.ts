import { WebClient } from "../http/web-client";
import { Saver } from "../managers/QueueProcessor";
import { Queue } from "../storage";
import { Trace } from "../util/trace";

/**
 * A Saver implementation that uses a WebClient to save facts.
 */
export class WebClientSaver implements Saver {
    constructor(
        private readonly client: WebClient,
        private readonly queue: Queue
    ) { }

    /**
     * Saves facts to the server and removes them from the queue.
     */
    async save(): Promise<void> {
        const envelopes = await this.queue.peek();
        if (envelopes.length > 0) {
            Trace.info(`WebClientSaver: Processing ${envelopes.length} envelopes from queue`);
            try {
                const startTime = Date.now();
                await this.client.saveWithRetry(envelopes);
                const duration = Date.now() - startTime;
                Trace.info(`WebClientSaver: Successfully saved ${envelopes.length} envelopes in ${duration}ms`);
                await this.queue.dequeue(envelopes);
            }
            catch (error) {
                Trace.error(`WebClientSaver: Failed to save ${envelopes.length} envelopes: ${error}`);
                throw error;
            }
        } else {
            Trace.info(`WebClientSaver: No envelopes in queue to process`);
        }
    }
}