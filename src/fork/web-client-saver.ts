import { isRefusal } from "../http/errors";
import { WebClient } from "../http/web-client";
import { Saver, SaveOutcome, SaveRequest } from "../managers/QueueProcessor";
import { FactEnvelope, FactRecord, FactReference, Queue } from "../storage";
import { Trace } from "../util/trace";

/**
 * Approximate upper bound on the serialized size of one `POST /save` request
 * (issue #245). A proxy in front of the replicator commonly caps request
 * bodies -- nginx's default `client_max_body_size` is 1 MB -- and a queue
 * flushed as one request will eventually exceed any such cap. This default
 * leaves generous headroom under the common 1 MB limit, because the budget is
 * measured against an estimate rather than the exact wire form.
 */
export const DEFAULT_MAX_SAVE_BATCH_BYTES = 256 * 1024;

/**
 * Upper bound on the number of facts in one `POST /save`, so a queue of many
 * tiny facts is still split into requests the replicator can process
 * comfortably.
 */
export const DEFAULT_MAX_SAVE_BATCH_COUNT = 200;

export interface WebClientSaverOptions {
    maxBatchBytes?: number;
    maxBatchCount?: number;
}

/**
 * UTF-8 byte length of a string, which is what a request-size limit actually
 * counts. `String.length` counts UTF-16 code units, so it under-reports every
 * non-ASCII character -- by a factor of three for CJK text, which is exactly
 * the data most likely to push a payload over a limit.
 *
 * Scanned rather than measured with `TextEncoder`, to avoid allocating a copy
 * of every fact in the queue on each flush. A lone surrogate is counted as 4
 * bytes where an encoder would emit a 3-byte replacement character; the budget
 * is a bound, so erring high is the safe direction.
 */
function utf8ByteLength(text: string): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) {
            bytes += 1;
        }
        else if (code < 0x800) {
            bytes += 2;
        }
        else if (code >= 0xd800 && code <= 0xdbff) {
            // High surrogate: the pair encodes to four bytes.
            bytes += 4;
            i++;
        }
        else {
            bytes += 3;
        }
    }
    return bytes;
}

/**
 * Estimate the serialized size of one envelope. This is deliberately an
 * estimate: the caller picks between the graph and JSON encodings inside
 * `saveWithRetry`, so the exact wire size is not knowable here. The batch
 * budget is a bound with headroom, not an accounting.
 */
function estimateSize(envelope: FactEnvelope): number {
    return utf8ByteLength(JSON.stringify(envelope));
}

/**
 * Take a caller-supplied bound only when it is a positive number. Zero or a
 * negative value would put one fact in every request, or none at all, rather
 * than doing what the name promises.
 */
function positiveOr(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && value > 0 ? value : fallback;
}

/**
 * Split the queue into batches that respect both bounds, preserving order.
 *
 * Order is not incidental. Facts form a DAG, and a fact later in the queue may
 * name an earlier one as a predecessor, so batches must be sent in the order
 * they were queued.
 *
 * An envelope larger than the byte budget gets a batch to itself. It cannot be
 * made to fit by batching, but dropping it would silently lose a write, and
 * merging it with neighbours would only take them down with it.
 */
export function batchEnvelopes(envelopes: FactEnvelope[], maxBatchBytes: number, maxBatchCount: number): FactEnvelope[][] {
    const batches: FactEnvelope[][] = [];
    let current: FactEnvelope[] = [];
    let currentBytes = 0;

    for (const envelope of envelopes) {
        const size = estimateSize(envelope);
        const wouldExceed = current.length > 0 &&
            (currentBytes + size > maxBatchBytes || current.length >= maxBatchCount);
        if (wouldExceed) {
            batches.push(current);
            current = [];
            currentBytes = 0;
        }
        current.push(envelope);
        currentBytes += size;
    }

    if (current.length > 0) {
        batches.push(current);
    }
    return batches;
}

/**
 * Identify a fact within one flush, so a refused fact can be recognized as the
 * predecessor of a later one. Type and hash together, because a hash is only
 * unique within a type.
 */
function factKey(reference: FactReference): string {
    return `${reference.type}:${reference.hash}`;
}

/**
 * The keys of every fact this one names as a predecessor, in any role.
 */
function predecessorKeys(fact: FactRecord): string[] {
    const keys: string[] = [];
    for (const role in fact.predecessors) {
        const value = fact.predecessors[role];
        if (Array.isArray(value)) {
            value.forEach(reference => keys.push(factKey(reference)));
        }
        else if (value) {
            keys.push(factKey(value));
        }
    }
    return keys;
}

/**
 * What one pass over the pending envelopes achieved.
 *
 * `accepted` drives whether another pass is worth making: a pass that accepted
 * something grew the replicator's graph, so a fact it refused may be authorized
 * now. `remaining` is the envelopes still queued, in queue order.
 */
interface FlushPass {
    accepted: number;
    remaining: FactEnvelope[];
    /** A connection failure ended the flush; no further request was made. */
    stopped: boolean;
    lastError: unknown;
}

/**
 * A Saver implementation that uses a WebClient to save facts.
 */
export class WebClientSaver implements Saver {
    private readonly maxBatchBytes: number;
    private readonly maxBatchCount: number;
    /**
     * The facts the replicator refused when they were sent on their own, keyed
     * as `type:hash`, each against the error that refused it (issue #410).
     *
     * A refusal of a lone fact is the replicator's judgment of that fact, and
     * `/save` authorizes a request as one unit, so carrying it in the next
     * batch refuses that whole batch and costs a request per fact to recover
     * from. These facts are therefore left out of a batch until something
     * happens that could change the answer: a fact this client just had
     * accepted, or an application asking again through `push()`.
     *
     * Derived, never persisted. A new saver starts with none, so it offers
     * every queued fact on its first flush, and a replicator whose rules or
     * model changed is picked up at the next start.
     */
    private readonly parked = new Map<string, unknown>();

    constructor(
        private readonly client: WebClient,
        private readonly queue: Queue,
        options: WebClientSaverOptions = {},
        /**
         * Called after each batch leaves the queue, so the owner can report how
         * many facts are still waiting to be sent (issue #306). Awaited, because
         * reading the queue's length is asynchronous and a report that races the
         * next batch would arrive out of order.
         */
        private readonly onQueueChanged: () => Promise<void> = () => Promise.resolve()
    ) {
        this.maxBatchBytes = positiveOr(options.maxBatchBytes, DEFAULT_MAX_SAVE_BATCH_BYTES);
        this.maxBatchCount = positiveOr(options.maxBatchCount, DEFAULT_MAX_SAVE_BATCH_COUNT);
    }

    /**
     * Saves facts to the server and removes them from the queue.
     *
     * The queue is flushed in size-bounded batches, and each batch that
     * succeeds is dequeued before the next is attempted (issue #245). Flushing
     * the whole queue as one request made the failure permanent: once the
     * accumulated payload passed a request-size limit anywhere between the
     * client and the replicator, every later write made the next attempt larger
     * and more certain to fail, so the queue could only grow.
     *
     * A batch that fails is one of two things, and they need opposite responses
     * (issue #395).
     *
     * A **connection failure** -- a transient status that outlived its retries,
     * an authentication challenge reauthentication did not cure, or an error
     * with no status at all -- says nothing about these facts. Every later
     * request in the flush would fail the same way, so the flush stops.
     *
     * A **refusal** is the replicator's judgment of these facts, and it is
     * judgment on the batch as a whole: `/save` authorizes a request as one
     * unit, and an authorization rule's successor walk reads only the store, so
     * a fact authorized by another fact in the same request is refused however
     * the request is ordered. Stopping the flush there made the queue
     * undrainable: the same batch was rebuilt and refused on every later flush,
     * and every fact behind it stayed queued across reloads, though the
     * replicator would have accepted them all in two requests.
     *
     * So a refused batch is narrowed to one fact per request, in queue order,
     * which commits each fact the replicator accepts before the facts after it
     * are tried. A fact that is still refused holds back only the queued facts
     * that descend from it; the rest continue to be sent. When a pass accepts
     * anything, the facts still refused are tried once more, because an
     * acceptance may have been the fact that authorizes them.
     *
     * Nothing is dropped. A refusal is not proof a fact is bad -- it is
     * evaluated against the replicator's graph, which may later gain the fact
     * that authorizes it -- so a fact still refused at the end of the flush
     * stays queued and is tried again on the next one.
     *
     * The outcome tells the caller which of those two endings it got
     * (issue #400). A flush the connection stopped is worth making again as
     * soon as the replicator is answering; a flush whose remaining facts were
     * all refused is not, because nothing has changed for them until a later
     * save grows the replicator's graph.
     *
     * A fact that stays refused used to make every later flush expensive
     * (issue #410). It is still queued, so it rode in the next flush's first
     * batch, that batch was refused whole because of it, and recovering cost
     * one request per fact in it. So a fact the replicator refused on its own
     * is **parked**: held out of the first batch, with the queued facts that
     * descend from it, exactly as a fact refused within this flush is. The cost
     * of sending new facts no longer depends on how many refused facts are
     * queued.
     *
     * A parked fact is offered again only when something could have changed the
     * answer. A pass that accepted anything grew the replicator's graph, and
     * what it accepted may be the fact that authorizes a parked one, so the
     * next pass offers them one request at a time. `retryParked` offers them
     * whether or not anything was accepted, which is what `push()` asks for: an
     * application may know of a change this client cannot see, such as another
     * replica writing the authorizing fact. A flush that accepts nothing and
     * was not asked offers none, because no request it could make would land.
     *
     * Nothing is dropped. A parked fact stays queued and in the local store,
     * the stall warning still counts it, and the set is held in memory only, so
     * a new saver offers every queued fact again.
     */
    async save(request: SaveRequest = {}): Promise<SaveOutcome> {
        const envelopes = await this.queue.peek();
        // The parked set describes what is queued, so a fact that has left the
        // queue leaves it too. Nothing else dequeues today, but a stale key
        // would hold back a descendant of a fact that is no longer there.
        this.prune(envelopes);
        if (envelopes.length === 0) {
            return { stalledOnConnection: false };
        }

        this.client.notifySyncStatus({
            sending: true,
            retrying: false,
            retryInSeconds: 0,
            warning: ""
        });

        let pending = envelopes;
        let lastError: unknown = undefined;
        let stoppedOnConnection = false;
        // The first pass batches as it always has, so a flush in which every
        // request succeeds sends exactly the requests it sent before.
        let batched = true;
        // ... and it holds the parked facts back, so the facts written since
        // one of them was refused are not refused along with it (issue #410).
        let offerParked = false;
        let parkedOffered = false;

        // A pass earns another one by accepting something, so the queue is
        // strictly shorter every time round. The one pass that is not earned
        // that way is the single `retryParked` pass, which can happen once.
        while (pending.length > 0) {
            const pass = await this.flushPass(pending, batched, offerParked);
            pending = pass.remaining;
            if (pass.lastError !== undefined) {
                lastError = pass.lastError;
            }
            if (pass.stopped) {
                stoppedOnConnection = true;
                break;
            }
            if (offerParked) {
                parkedOffered = true;
            }
            // Something was accepted, so the replicator's graph has grown and a
            // fact it refused may be authorized now. A caller that asked for
            // the parked facts gets one pass that offers them regardless.
            const anotherPass = pass.accepted > 0 ||
                (request.retryParked === true && !parkedOffered);
            if (!anotherPass) {
                break;
            }
            // Try the rest one request at a time, so a refused fact never
            // travels with a fact that descends from it, and offer the parked
            // facts among them.
            batched = false;
            offerParked = true;
        }

        if (lastError === undefined) {
            // Every fact still queued was parked by an earlier flush and this
            // one made no request for it, so the refusal that parked it is what
            // there is to report.
            lastError = this.parkedReason(pending);
        }

        if (pending.length === 0) {
            this.client.notifySyncStatus({
                sending: false,
                retrying: false,
                retryInSeconds: 0,
                warning: ""
            });
        }
        else {
            // Report the stall rather than only logging it. Without this an
            // application sees every write resolve normally while its local
            // store diverges from the replicator, with nothing anywhere to
            // tell it -- the failure that made the reported incident
            // invisible for as long as it was.
            const reason = lastError instanceof Error ? lastError.message : `${lastError}`;
            this.client.notifySyncStatus({
                sending: false,
                retrying: false,
                retryInSeconds: 0,
                warning: `${pending.length} fact(s) could not be sent to the replicator: ${reason}`
            });
        }

        return { stalledOnConnection: pending.length > 0 && stoppedOnConnection };
    }

    /**
     * One pass over the envelopes still queued, in queue order.
     *
     * `batched` groups them under the size and count bounds, as an ordinary
     * flush does. Without it each envelope gets a request of its own, which is
     * what a pass after a refusal needs: a fact must never share a request with
     * a fact that descends from it, because the refusal of one would be read as
     * the refusal of both.
     *
     * `offerParked` sends the facts parked by an earlier flush as well
     * (issue #410). Without it they start out held, which is what keeps a fact
     * the replicator has already refused on its own out of a batch of facts it
     * would otherwise accept.
     */
    private async flushPass(pending: FactEnvelope[], batched: boolean, offerParked: boolean): Promise<FlushPass> {
        const sent = new Set<string>();
        // Facts this pass will not send, and the queued facts that descend from
        // them: the ones the replicator refused in this pass, and -- unless
        // this pass is offering them -- the ones it refused in an earlier one.
        // Queue order is topological, so by the time a fact is reached every
        // queued predecessor of it has been decided.
        const held = offerParked ? new Set<string>() : new Set<string>(this.parked.keys());
        // What this pass will actually offer. A fact already held when the pass
        // starts is not going to be sent, so it takes up no room in a batch:
        // leaving it in would spend its bytes and its slot against the budget,
        // and a parked fact at the budget would push the facts written after it
        // into requests of their own -- the dependency on the parked facts that
        // issue #410 is about. The queued facts that descend from a parked one
        // cost exactly as much, so they are excluded here too rather than
        // during the send walk, which reaches them only after they have taken
        // up room. Queue order is topological, so one pass in that order sees
        // every predecessor before the fact that names it.
        const offered: FactEnvelope[] = [];
        for (const envelope of pending) {
            if (held.size > 0 && this.isHeld(envelope, held)) {
                held.add(factKey(envelope.fact));
            }
            else {
                offered.push(envelope);
            }
        }
        const batches = batched
            ? batchEnvelopes(offered, this.maxBatchBytes, this.maxBatchCount)
            : offered.map(envelope => [envelope]);
        let accepted = 0;
        let lastError: unknown = undefined;

        const remaining = () => pending.filter(envelope => !sent.has(factKey(envelope.fact)));

        for (const batch of batches) {
            const sendable: FactEnvelope[] = [];
            for (const envelope of batch) {
                if (this.isHeld(envelope, held)) {
                    held.add(factKey(envelope.fact));
                }
                else {
                    sendable.push(envelope);
                }
            }
            if (sendable.length === 0) {
                continue;
            }

            let refused = false;
            try {
                await this.send(sendable, sent);
                accepted += sendable.length;
            }
            catch (error) {
                lastError = error;
                if (!isRefusal(error)) {
                    // The flush ends here, so this is the failure the caller
                    // needs to see.
                    Trace.error(error);
                    return { accepted, remaining: remaining(), stopped: true, lastError };
                }
                // A refusal is worked around by narrowing, and may be cured
                // before the flush ends, so it is not reported as an error.
                // What survives the flush is reported through the sync status.
                Trace.warn(`The replicator refused ${sendable.length} fact(s): ${error instanceof Error ? error.message : error}`);
                refused = true;
            }
            if (!refused) {
                continue;
            }
            if (sendable.length === 1) {
                // Already as narrow as a request gets, so this is the
                // replicator's judgment of that one fact.
                this.park(sendable[0].fact, lastError, held);
                continue;
            }

            // Narrow the refused batch. A fact refused only because it
            // travelled with others is accepted once they are committed.
            for (const envelope of sendable) {
                if (this.isHeld(envelope, held)) {
                    held.add(factKey(envelope.fact));
                    continue;
                }
                try {
                    await this.send([envelope], sent);
                    accepted++;
                }
                catch (error) {
                    lastError = error;
                    if (!isRefusal(error)) {
                        Trace.error(error);
                        return { accepted, remaining: remaining(), stopped: true, lastError };
                    }
                    Trace.warn(`The replicator refused ${factKey(envelope.fact)}: ${error instanceof Error ? error.message : error}`);
                    this.park(envelope.fact, error, held);
                }
            }
        }

        return { accepted, remaining: remaining(), stopped: false, lastError };
    }

    /**
     * Is this fact held out of this pass, or is one of its queued predecessors?
     * Sending a fact whose predecessor is refused would leave a dangling
     * reference, so it stays queued with it.
     */
    private isHeld(envelope: FactEnvelope, held: Set<string>): boolean {
        return held.has(factKey(envelope.fact)) ||
            predecessorKeys(envelope.fact).some(key => held.has(key));
    }

    /**
     * Record that the replicator refused this fact on its own, so later flushes
     * leave it out of their first batch (issue #410). It is held for the rest
     * of this pass too, which is what keeps its queued descendants back.
     */
    private park(fact: FactRecord, reason: unknown, held: Set<string>): void {
        const key = factKey(fact);
        this.parked.set(key, reason);
        held.add(key);
    }

    /**
     * Forget the facts that are no longer queued, so the set stays a statement
     * about the queue rather than a growing memory of it.
     */
    private prune(envelopes: FactEnvelope[]): void {
        if (this.parked.size === 0) {
            return;
        }
        const queued = new Set(envelopes.map(envelope => factKey(envelope.fact)));
        for (const key of [...this.parked.keys()]) {
            if (!queued.has(key)) {
                this.parked.delete(key);
            }
        }
    }

    /**
     * The refusal that parked the first of these facts, for a flush that made
     * no request of its own and so has no error to report.
     */
    private parkedReason(pending: FactEnvelope[]): unknown {
        for (const envelope of pending) {
            const key = factKey(envelope.fact);
            if (this.parked.has(key)) {
                return this.parked.get(key);
            }
        }
        return undefined;
    }

    private async send(envelopes: FactEnvelope[], sent: Set<string>): Promise<void> {
        await this.client.saveWithRetry(envelopes);
        await this.queue.dequeue(envelopes);
        envelopes.forEach(envelope => {
            const key = factKey(envelope.fact);
            sent.add(key);
            // Accepted, so there is nothing left to park it for.
            this.parked.delete(key);
        });
        await this.onQueueChanged();
    }
}
