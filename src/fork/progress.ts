import { Trace } from "../util/trace";

/**
 * The listeners watching how many facts are waiting to be sent (issue #306).
 *
 * The notifier holds the listeners and nothing else. The count it delivers is
 * read from the queue at the moment it is reported, so there is no second copy
 * of the queue's length to fall out of step with it.
 */
export class ProgressNotifier {
    private readonly listeners = new Set<(count: number) => void>();

    onProgress(listener: (count: number) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Whether anyone is listening. A fork reads the queue to report its length,
     * so an application that registered no handler pays nothing for the channel.
     */
    get listening(): boolean {
        return this.listeners.size > 0;
    }

    notify(count: number) {
        // A throwing listener must not abort delivery to the others, nor bubble
        // into the save it is reporting on.
        for (const listener of this.listeners) {
            try { listener(count); } catch (e) { Trace.error(e); }
        }
    }
}
