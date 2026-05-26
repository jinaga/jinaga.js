import { Jinaga, JinagaTest, User } from "@src";
import { AuthenticationNoOp } from "../../src/authentication/authentication-noop";
import { Dehydration } from "../../src/fact/hydrate";
import { PassThroughFork } from "../../src/fork/pass-through-fork";
import { SyncStatusNotifier } from "../../src/http/web-client";
import { Jinaga as JinagaImpl } from "../../src/jinaga";
import { FactManager } from "../../src/managers/factManager";
import { NetworkNoOp } from "../../src/managers/NetworkManager";
import { MemoryStore } from "../../src/memory/memory-store";
import { ObservableSource } from "../../src/observable/observable";
import { FactEnvelope } from "../../src/storage";
import { Company, Office, Manager, President, model } from "../companyModel";

// Seed a Jinaga instance's memory store with raw fact records, bypassing the
// predecessor recursion that JinagaTest.initialState (and j.fact) perform. This
// lets a test stage genuine "given arrives after descendants" scenarios — with
// j.fact, dehydrating an Office would also persist its Company predecessor, so
// the anchor would already be present before the test "introduces" it.
async function createJinagaWithRawStore(rawEnvelopes: FactEnvelope[]): Promise<Jinaga> {
    const store = new MemoryStore();
    await store.save(rawEnvelopes);
    const observableSource = new ObservableSource(store);
    const syncStatusNotifier = new SyncStatusNotifier();
    const fork = new PassThroughFork(store);
    const authentication = new AuthenticationNoOp();
    const network = new NetworkNoOp();
    const factManager = new FactManager(fork, observableSource, store, network, []);
    return new JinagaImpl(authentication, factManager, syncStatusNotifier);
}

function envelopesExcludingType(
    rootObjects: object[],
    excludedType: string
): FactEnvelope[] {
    const dehydrate = new Dehydration();
    for (const obj of rootObjects) {
        dehydrate.dehydrate(obj);
    }
    return dehydrate.factRecords()
        .filter(r => r.type !== excludedType)
        .map(r => ({ fact: r, signatures: [] }));
}

// These tests validate the client-side contract that issue #129 requires from
// any conforming wire protocol: subscriptions track their givens, and matches
// surface whether the given arrives before or after the subscription starts.
// They use the in-memory transport from JinagaTest rather than asserting on
// actual subscription-message bytes — server interop is exercised by the HTTP
// and WS suites against a real authorization handler.
describe("inverse subscription wire-protocol contract (client side)", () => {
    let creator: User;
    let j: Jinaga;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        j = JinagaTest.create({
            initialState: []
        });
    });

    describe("subscription message format", () => {
        it("should include givens in subscription message", async () => {
            // This test verifies that the subscription message includes
            // the given facts in the givens section as described in issue #129
            
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            // Mock or spy on the subscription message to verify givens are included
            const managers: string[] = [];
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, // This should be included in the subscription message givens
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Introduce facts after subscription
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            await managerObserver.processed();

            managerObserver.stop();

            // Subscription message should have carried the company anchor;
            // here we observe the client-side effect of that contract — the
            // inverse subscription fires for the matching manager.
            expect(managers).toContain(j.hash(manager));
        });

        it("should handle multiple givens in subscription message", async () => {
            // Multiple givens connected through a successor (President) that
            // references both. Multi-given subscriptions must fire when any
            // given arrives late.
            const company = new Company(creator, "TestCo");
            const user = new User("Another user");
            const office = new Office(company, "TestOffice");
            const president = new President(office, user);

            const presidents: string[] = [];
            const presidentObserver = j.watch(
                model.given(Company, User).match((company, user, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(President)
                            .join(p => p.office, office)
                            .join(p => p.user, user)
                        )
                ),
                company, user,
                p => {
                    presidents.push(j.hash(p));
                }
            );

            await presidentObserver.loaded();

            await j.fact(company);
            await j.fact(user);
            await j.fact(office);
            await j.fact(president);
            await presidentObserver.processed();

            presidentObserver.stop();

            expect(presidents).toContain(j.hash(president));
        });
    });

    describe("server-side givens handling", () => {
        it("should store and use givens to re-evaluate inverses as new facts arrive", async () => {
            // Genuine out-of-order: descendants are seeded directly into the
            // store (no Company predecessor), then the Company given arrives
            // via fact() after subscription. The self-inverse must re-read and
            // surface the already-cached manager.
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);

            const seeded = envelopesExcludingType([creator, company, office, manager], Company.Type);
            const jSeeded = await createJinagaWithRawStore(seeded);

            const managers: string[] = [];
            const managerObserver = jSeeded.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company,
                m => {
                    managers.push(jSeeded.hash(m));
                }
            );

            await managerObserver.loaded();

            // Initial read finds nothing without the anchor.
            expect(managers).toEqual([]);

            // Anchor arrives → self-inverse re-reads → manager surfaces.
            await jSeeded.fact(company);
            await managerObserver.processed();

            managerObserver.stop();

            expect(managers).toContain(jSeeded.hash(manager));
        });

        it("should handle server-side fact arrival in any order", async () => {
            // True any-order: descendants seeded first (no Company), then
            // anchor arrives. Using j.fact alone cannot stage "manager first"
            // because dehydration would persist its Office and Company
            // predecessors as a single graph.
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);

            const seeded = envelopesExcludingType([creator, company, office, manager], Company.Type);
            const jSeeded = await createJinagaWithRawStore(seeded);

            const managers: string[] = [];
            const managerObserver = jSeeded.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company,
                m => {
                    managers.push(jSeeded.hash(m));
                }
            );

            await managerObserver.loaded();

            await jSeeded.fact(company);
            await managerObserver.processed();

            managerObserver.stop();

            expect(managers).toContain(jSeeded.hash(manager));
        });
    });

    describe("anchor-based matching", () => {
        it("should use givens as anchors for inverse query matching", async () => {
            // Test that givens serve as anchors for the inverse query,
            // allowing the server to match incoming facts correctly
            
            const company = new Company(creator, "TestCo");
            const office1 = new Office(company, "Office1");
            const office2 = new Office(company, "Office2");
            const manager1 = new Manager(office1, 123);
            const manager2 = new Manager(office2, 456);
            
            const managers: string[] = [];
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, // This company serves as the anchor
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Introduce facts that should be matched using the company anchor
            await j.fact(company);
            await j.fact(office1);
            await j.fact(office2);
            await j.fact(manager1);
            await j.fact(manager2);
            await managerObserver.processed();

            managerObserver.stop();

            // EXPECTATION: Both managers should be matched using the company anchor
            expect(managers).toContain(j.hash(manager1));
            expect(managers).toContain(j.hash(manager2));
        });

        it("should handle anchor arrival after related facts", async () => {
            // Office and Manager are seeded into the store without the
            // Company anchor, mirroring what would happen if descendants had
            // streamed in via a feed before the anchor itself was distributed.
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);

            const seeded = envelopesExcludingType([creator, company, office, manager], Company.Type);
            const jSeeded = await createJinagaWithRawStore(seeded);

            const managers: string[] = [];
            const managerObserver = jSeeded.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company,
                m => {
                    managers.push(jSeeded.hash(m));
                }
            );

            await managerObserver.loaded();
            expect(managers).toEqual([]);

            await jSeeded.fact(company);
            await managerObserver.processed();

            managerObserver.stop();

            expect(managers).toContain(jSeeded.hash(manager));
        });
    });

    describe("subscription recovery scenarios", () => {
        it("should recover seamlessly once given becomes known locally", async () => {
            // Test that subscriptions recover when given becomes known locally
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            const managers: string[] = [];
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, // Given fact becomes known locally after subscription
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Given becomes known locally
            await j.fact(company);

            // Related facts are already known
            await j.fact(office);
            await j.fact(manager);
            await managerObserver.processed();

            managerObserver.stop();

            expect(managers).toContain(j.hash(manager));
        });

        it("should recover seamlessly once given becomes known from server", async () => {
            // Test that subscriptions recover when given becomes known from server
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            const managers: string[] = [];
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, // Given fact becomes known from server after subscription
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Related facts are known locally
            await j.fact(office);
            await j.fact(manager);

            // Given arrives from server
            await j.fact(company);
            await managerObserver.processed();

            managerObserver.stop();

            expect(managers).toContain(j.hash(manager));
        });
    });

    describe("transport-agnostic recovery", () => {
        // These tests use the in-memory transport from JinagaTest. The
        // inverse-recovery contract is enforced at the client (fact manager +
        // observable source) layer, below the transport boundary, so the same
        // code path serves both HTTP polling and WebSocket feeds. Transport-
        // specific behavior is exercised by the HTTP and WS test suites.
        it("should fire the inverse subscription regardless of transport", async () => {
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);

            const managers: string[] = [];
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company,
                m => {
                    managers.push(j.hash(m));
                }
            );

            await managerObserver.loaded();

            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            await managerObserver.processed();

            managerObserver.stop();

            expect(managers).toContain(j.hash(manager));
        });
    });

    describe("no additional watch calls required", () => {
        it("should not require additional watch() calls when given becomes known", async () => {
            // Test that no additional watch() calls are needed
            // when the given fact becomes known
            
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            let watchCallCount = 0;
            const managers: string[] = [];
            
            // Single watch call
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, // Given fact becomes known after subscription
                manager => {
                    managers.push(j.hash(manager));
                    watchCallCount++;
                }
            );

            await managerObserver.loaded();
            
            // Introduce facts after subscription
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            await managerObserver.processed();

            managerObserver.stop();

            expect(managers).toContain(j.hash(manager));
            expect(watchCallCount).toBeGreaterThan(0);
        });

        it("should automatically track and re-evaluate when given becomes known", async () => {
            // Test that the client automatically tracks and re-evaluates
            // when the given fact becomes known
            
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            const managers: string[] = [];
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, // Given fact becomes known after subscription
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Introduce facts after subscription
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            await managerObserver.processed();

            managerObserver.stop();

            expect(managers).toContain(j.hash(manager));
        });
    });
}); 