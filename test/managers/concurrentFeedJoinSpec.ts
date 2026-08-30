import { User } from "@src";
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

const managersInOffice = model.given(Office).match((office, facts) =>
    facts.ofType(Manager).join(manager => manager.office, office)
).specification;

/**
 * One feed delivering two pages. Page two is only reachable by a caller that
 * waits for the whole feed, so a caller that bails out early is detectable as
 * a short result set rather than as a timing difference.
 */
class TwoPageNetwork implements Network {
    constructor(
        private readonly page1: FactEnvelope[],
        private readonly page2: FactEnvelope[]
    ) { }

    feeds(): Promise<FeedsResponse> {
        return Promise.resolve({ feeds: ["feed-1"] });
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        if (bookmark === "") {
            return Promise.resolve({ references: this.page1.map(e => ({ type: e.fact.type, hash: e.fact.hash })), bookmark: "1" });
        }
        if (bookmark === "1") {
            return Promise.resolve({ references: this.page2.map(e => ({ type: e.fact.type, hash: e.fact.hash })), bookmark: "2" });
        }
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(): () => void {
        return () => { };
    }

    load(references: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([...this.page1, ...this.page2]
            .filter(e => references.some(r => r.hash === e.fact.hash)));
    }

    intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        return Promise.resolve([{ start, specification }]);
    }
}

/**
 * A guard that declines to join an in-flight feed while a listener is running
 * was considered for issue #246, to break the re-entrant cycle directly rather
 * than waiting out the listener timeout. It cannot be scoped to the re-entrant
 * caller without async context propagation, so it also fires for an ordinary
 * concurrent caller -- which then reads a partially loaded feed and returns a
 * short result set with no error. This test pins the behavior that must hold:
 * a caller outside any listener always gets the whole feed.
 */
describe("joining an in-flight feed during a notification (issue #246)", () => {
    it("gives a concurrent caller the complete feed, not just what is already saved", async () => {
        const creator = new User("--- PUBLIC KEY GOES HERE ---");
        const company = new Company(creator, "TestCo");
        const office = new Office(company, "TestOffice");

        const first = new Dehydration();
        const officeReference = first.dehydrate(office);
        first.dehydrate(new Manager(office, 1));
        const page1 = first.factRecords().map(fact => <FactEnvelope>{ fact, signatures: [] });

        const second = new Dehydration();
        second.dehydrate(new Manager(office, 2));
        const page2 = second.factRecords().map(fact => <FactEnvelope>{ fact, signatures: [] });

        const store = new MemoryStore();
        const observableSource = new ObservableSource(store, { listenerTimeoutMs: 30000 });
        const factManager = new FactManager(new PassThroughFork(store),
            observableSource, store, new TwoPageNetwork(page1, page2), []);

        // A healthy but slow listener, so the first page's notification is
        // still in flight when the second caller arrives. It settles on its
        // own; nothing here depends on that caller returning.
        let dispatching = false;
        factManager.addSpecificationListener(managersInOffice, async () => {
            dispatching = true;
            await new Promise<void>(resolve => setTimeout(resolve, 300));
            dispatching = false;
        });

        const loading = factManager.fetch([officeReference], managersInOffice);
        await waitForCondition(() => dispatching, 3000);

        // An ordinary caller, outside every listener. It must share the
        // in-flight load rather than reading around it.
        await factManager.fetch([officeReference], managersInOffice);
        const concurrent = await factManager.read([officeReference], managersInOffice);

        await loading;
        expect(concurrent.length).toBe(2);
    }, 15000);
});
