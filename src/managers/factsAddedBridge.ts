import { FactEnvelope } from "../storage";

/**
 * A network that pushes facts of its own accord, rather than only in reply to
 * a request, and reports each saved batch to a listener.
 *
 * The listener's promise is the source's ordering signal: a source that awaits
 * it -- `WsGraphClient` does, so one socket's batches stay in order -- holds
 * its next batch until the notification for the previous one is finished.
 */
export interface FactsAddedSource {
    setFactsAddedListener(listener: (envelopes: FactEnvelope[]) => Promise<void>): void;
}

/**
 * The notification a source's batch is fed into, as `FactManager` implements
 * it.
 */
export interface FactsAddedTarget {
    notifyFactsAdded(envelopes: FactEnvelope[]): Promise<void>;
}

/**
 * Whether this network reports the facts it pushes. Not every `Network` does,
 * so the caller narrows before connecting.
 */
export function isFactsAddedSource(network: unknown): network is FactsAddedSource {
    return typeof (network as Partial<FactsAddedSource> | null | undefined)?.setFactsAddedListener === "function";
}

/**
 * Feed the source's saved batches into the target's notification, returning
 * that notification's promise to the source.
 *
 * Returning it is the whole point. The source decides when to read its next
 * batch from this promise, so a bridge that dropped it would let the next
 * batch be saved while the previous one was still being notified, and would
 * leave a failed notification as an unhandled rejection instead of handing it
 * back to the source.
 */
export function connectFactsAdded(source: FactsAddedSource, target: FactsAddedTarget): void {
    source.setFactsAddedListener(envelopes => target.notifyFactsAdded(envelopes));
}
