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
            try {
                await this.client.saveWithRetry(envelopes);
                await this.queue.dequeue(envelopes);
            }
            catch (error) {
                Trace.error(error);
            }
        }
    }
}