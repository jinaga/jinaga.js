import { WebClient } from "../http/web-client";
import { Saver } from "../managers/QueueProcessor";
import { FactEnvelope, Queue } from "../storage";
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
 * A Saver implementation that uses a WebClient to save facts.
 */
export class WebClientSaver implements Saver {
    private readonly maxBatchBytes: number;
    private readonly maxBatchCount: number;

    constructor(
        private readonly client: WebClient,
        private readonly queue: Queue,
        options: WebClientSaverOptions = {}
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
     * The flush stops at the first batch that fails rather than skipping past
     * it. A fact behind the failed batch may name one of its facts as a
     * predecessor, and sending it first would leave a dangling reference.
     * Stopping still makes progress -- everything ahead of the blocking batch
     * has drained -- so the queue shrinks instead of growing without bound.
     */
    async save(): Promise<void> {
        const envelopes = await this.queue.peek();
        if (envelopes.length === 0) {
            return;
        }

        const batches = batchEnvelopes(envelopes, this.maxBatchBytes, this.maxBatchCount);
        let sent = 0;

        this.client.notifySyncStatus({
            sending: true,
            retrying: false,
            retryInSeconds: 0,
            warning: ""
        });

        for (const batch of batches) {
            try {
                await this.client.saveWithRetry(batch);
                await this.queue.dequeue(batch);
                sent += batch.length;
            }
            catch (error) {
                Trace.error(error);
                // Report the stall rather than only logging it. Without this an
                // application sees every write resolve normally while its local
                // store diverges from the replicator, with nothing anywhere to
                // tell it -- the failure that made the reported incident
                // invisible for as long as it was.
                const remaining = envelopes.length - sent;
                const reason = error instanceof Error ? error.message : `${error}`;
                this.client.notifySyncStatus({
                    sending: false,
                    retrying: false,
                    retryInSeconds: 0,
                    warning: `${remaining} fact(s) could not be sent to the replicator: ${reason}`
                });
                return;
            }
        }

        this.client.notifySyncStatus({
            sending: false,
            retrying: false,
            retryInSeconds: 0,
            warning: ""
        });
    }
}
