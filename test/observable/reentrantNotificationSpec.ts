import { NoOpTracer, Trace, Tracer, User } from "@src";
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { Dehydration } from "../../src/fact/hydrate";
import { PassThroughFork } from "../../src/fork/pass-through-fork";
import { FeedResponse, FeedsResponse } from "../../src/http/messages";
import { FactManager } from "../../src/managers/factManager";
import { Network } from "../../src/managers/NetworkManager";
import { MemoryStore } from "../../src/memory/memory-store";
import { ObservableSource } from "../../src/observable/observable";
import { Specification } from "../../src/specification/specification";
import { FactEnvelope, FactReference } from "../../src/storage";
import { Company, Manager, Office, model } from "../companyModel";
import { waitForCondition } from "../utils/async-test-utils";

class CountingTracer extends NoOpTracer implements Tracer {
    public readonly counters: { [name: string]: number } = {};
    counter(name: string, value: number): void {
        this.counters[name] = (this.counters[name] ?? 0) + value;
    }
}

/**
 * Maps every specification to one feed, delivers a single graph on the first
 * fetchFeed, then reports end-of-feed. Because every query resolves to the same
 * feed hash, a query issued from inside a notification joins the in-flight
 * processFeed through `activeFeeds` — exactly the shape reported in issue #246.
 */
class OneShotFeedNetwork implements Network {
    private delivered = false;

    constructor(private readonly envelopes: FactEnvelope[]) { }

    feeds(): Promise<FeedsResponse> {
        return Promise.resolve({ feeds: ["feed-1"] });
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        if (this.delivered) {
            return Promise.resolve({ references: [], bookmark });
        }
        this.delivered = true;
        return Promise.resolve({
            references: this.envelopes.map(e => ({ type: e.fact.type, hash: e.fact.hash })),
            bookmark: "1"
        });
    }

    streamFeed(): () => void {
        return () => { };
    }

    load(): Promise<FactEnvelope[]> {
        return Promise.resolve(this.envelopes);
    }

    intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        return Promise.resolve([{ start, specification }]);
    }
}

/** Race a promise against a deadline. Always clears the timer. */
function raceDeadline<T>(promise: Promise<T>, ms: number): Promise<"settled" | "timed-out"> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        promise.then(() => "settled" as const, () => "settled" as const),
        new Promise<"timed-out">(resolve => { timer = setTimeout(() => resolve("timed-out"), ms); })
    ]).finally(() => clearTimeout(timer!));
}

const managersInOffice = model.given(Office).match((office, facts) =>
    facts.ofType(Manager)
        .join(manager => manager.office, office)
).specification;

/**
 * The re-entrant cycle reported in issue #246: `processFeed` parks on
 * `LoadBatch.completed`, the batch awaits `notifyFactsAdded`, and a listener
 * dispatched from that notification queries a specification resolving to the
 * same feed. It joins `activeFeeds` and waits on a promise that cannot resolve
 * until the listener returns.
 *
 * Nothing here detects that cycle. The listener timeout breaks it: the wait on
 * the callback is abandoned, the notification concludes, the batch resolves,
 * and the inner query completes on the way out. The cost is one stall bounded
 * by `listenerTimeoutMs`, which is what makes this recoverable instead of
 * permanent.
 */
describe("a listener that queries while its own feed is loading (issue #246)", () => {
    let tracer: CountingTracer;

    beforeEach(() => {
        tracer = new CountingTracer();
        Trace.configure(tracer);
    });

    afterEach(() => {
        Trace.off();
    });

    it("does not deadlock against the in-flight feed", async () => {
        const creator = new User("--- PUBLIC KEY GOES HERE ---");
        const company = new Company(creator, "TestCo");
        const office = new Office(company, "TestOffice");
        const manager = new Manager(office, 42);

        const dehydration = new Dehydration();
        const officeReference = dehydration.dehydrate(office);
        dehydration.dehydrate(manager);
        const envelopes = dehydration.factRecords().map(fact => <FactEnvelope>{ fact, signatures: [] });

        const store = new MemoryStore();
        // Short enough to keep the test quick, long enough that the stall is
        // unambiguously the timeout firing rather than incidental scheduling.
        const listenerTimeoutMs = 300;
        const observableSource = new ObservableSource(store, { listenerTimeoutMs });
        const network = new OneShotFeedNetwork(envelopes);
        const factManager = new FactManager(new PassThroughFork(store), observableSource, store, network, []);

        let innerSettled = false;
        let innerError: unknown;
        factManager.addSpecificationListener(managersInOffice, async () => {
            // A re-entrant query from inside the notification, the shape the
            // issue reports: subscribe, then read before writing a completion
            // fact. It joins activeFeeds["feed-1"], whose processFeed is parked
            // on a batch that is awaiting this very callback.
            try {
                await factManager.fetch([officeReference], managersInOffice);
            }
            catch (e) {
                innerError = e;
            }
            finally {
                innerSettled = true;
            }
        });

        // Before the fix neither of these ever settles.
        const start = Date.now();
        await expect(raceDeadline(factManager.fetch([officeReference], managersInOffice), 5000))
            .resolves.toBe("settled");
        const elapsed = Date.now() - start;
        await waitForCondition(() => innerSettled, 2000);

        expect(innerError).toBeUndefined();
        // The cycle is broken by abandoning the wait on the callback, so the
        // outer fetch settles at roughly the bound rather than never.
        expect(tracer.counters["observable_listener_timed_out"]).toBeGreaterThan(0);
        expect(elapsed).toBeGreaterThanOrEqual(listenerTimeoutMs - 50);

        // The re-entrant read saw the facts the outer load had already saved.
        const results = await factManager.read([officeReference], managersInOffice);
        expect(results.length).toBe(1);
    }, 15000);
});
