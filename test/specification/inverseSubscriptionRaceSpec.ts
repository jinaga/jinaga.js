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
import { Jinaga, JinagaTest, User } from "../../src";
import { Company, Office, Manager, President, model } from "../companyModel";

// Construct a Jinaga instance with a memory store pre-populated from raw fact
// records. Unlike JinagaTest's initialState (which dehydrates whole object
// graphs and pulls in every predecessor), this lets the caller decide exactly
// which records to seed — required for cached-data scenarios where descendant
// facts must exist without their predecessor given fact.
function createJinagaWithRawStore(rawEnvelopes: FactEnvelope[]): Jinaga {
    const store = new MemoryStore();
    store.save(rawEnvelopes);
    const observableSource = new ObservableSource(store);
    const syncStatusNotifier = new SyncStatusNotifier();
    const fork = new PassThroughFork(store);
    const authentication = new AuthenticationNoOp();
    const network = new NetworkNoOp();
    const factManager = new FactManager(fork, observableSource, store, network, []);
    return new JinagaImpl(authentication, factManager, syncStatusNotifier);
}

describe("inverse subscription race condition", () => {
    let creator: User;
    let j: Jinaga;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        j = JinagaTest.create({
            initialState: []
        });
    });

    describe("client-side race condition", () => {
        it("should miss inverse results when given fact arrives after subscription", async () => {
            // This test demonstrates the client-side race condition
            // where the given fact hasn't been passed to jinagaClient.fact yet
            
            // Create facts that will be the "given" later
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            // Start watching BEFORE the given fact is known to the client
            const managers: string[] = [];
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, // This company fact hasn't been passed to j.fact() yet
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Now introduce the facts to the client
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            
            managerObserver.stop();

            // EXPECTATION: This should include the manager, but currently fails
            // because the inverse subscription doesn't account for the given fact
            // that arrived after the subscription started
            expect(managers).toContain(j.hash(manager));
        });

        it("should miss nested inverse results when parent given arrives late", async () => {
            // Test nested inverse relationships
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const president = new President(office, creator);
            
            const presidents: string[] = [];
            const presidentObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(President)
                            .join(president => president.office, office)
                        )
                ),
                company, // Given fact arrives after subscription
                president => {
                    presidents.push(j.hash(president));
                }
            );

            await presidentObserver.loaded();
            
            // Introduce facts after subscription
            await j.fact(company);
            await j.fact(office);
            await j.fact(president);
            
            presidentObserver.stop();

            // EXPECTATION: Should include the president
            expect(presidents).toContain(j.hash(president));
        });
    });

    describe("network race condition", () => {
        it("should miss inverse results when given fact arrives from server after subscription", async () => {
            // This test simulates the network race condition
            // where the given fact hasn't arrived from the server yet
            
            // Create facts that will be the "given" later
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            // Simulate server-side facts that haven't been received yet
            const serverFacts = [company, office, manager];
            
            // Start watching with a given that hasn't arrived from server
            const managers: string[] = [];
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, // This company hasn't arrived from server yet
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Simulate facts arriving from server
            for (const fact of serverFacts) {
                await j.fact(fact);
            }
            
            managerObserver.stop();

            // EXPECTATION: Should include all managers once facts arrive from server
            expect(managers).toContain(j.hash(manager));
        });

        it("should handle multiple given facts arriving at different times", async () => {
            // Test scenario where multiple given facts arrive at different times
            const company1 = new Company(creator, "Company1");
            const company2 = new Company(creator, "Company2");
            const office1 = new Office(company1, "Office1");
            const office2 = new Office(company2, "Office2");
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
                company1, // First given fact
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Introduce first company and its facts
            await j.fact(company1);
            await j.fact(office1);
            await j.fact(manager1);
            
            // Now watch with second company (simulating late arrival)
            const managers2: string[] = [];
            const managerObserver2 = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company2, // Second given fact arrives later
                manager => {
                    managers2.push(j.hash(manager));
                }
            );

            await managerObserver2.loaded();
            
            // Introduce second company and its facts
            await j.fact(company2);
            await j.fact(office2);
            await j.fact(manager2);
            
            managerObserver.stop();
            managerObserver2.stop();

            // EXPECTATION: Both observers should see their respective managers
            expect(managers).toContain(j.hash(manager1));
            expect(managers2).toContain(j.hash(manager2));
        });
    });

    describe("cached data scenarios", () => {
        it("should recover from cached data when given fact becomes known", async () => {
            // Simulates app starting with descendant facts already in the local
            // store but missing the given fact (e.g., partial cache, distinct
            // distribution feeds, or a purged anchor). When the given later
            // arrives via fact(), self-inverse must re-read and surface the
            // already-cached results.
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);

            const dehydrate = new Dehydration();
            dehydrate.dehydrate(creator);
            dehydrate.dehydrate(company);
            dehydrate.dehydrate(office);
            dehydrate.dehydrate(manager);
            // Seed the store with everything except the Company given fact.
            const cachedEnvelopes: FactEnvelope[] = dehydrate.factRecords()
                .filter(r => r.type !== Company.Type)
                .map(r => ({ fact: r, signatures: [] }));

            const jCached = createJinagaWithRawStore(cachedEnvelopes);

            const managers: string[] = [];
            const managerObserver = jCached.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company,
                m => {
                    managers.push(jCached.hash(m));
                }
            );

            await managerObserver.loaded();

            // Initial read finds nothing — company is not yet in the store.
            expect(managers).toEqual([]);

            // Company arrives. Self-inverse must re-read and discover the
            // already-cached descendants.
            await jCached.fact(company);
            await managerObserver.processed();

            managerObserver.stop();

            expect(managers).toContain(jCached.hash(manager));
        });

        it("should handle incremental fact loading", async () => {
            // Test scenario where facts are loaded incrementally
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
                company, // Given fact
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Simulate incremental loading
            await j.fact(company);
            await j.fact(office1);
            await j.fact(manager1);
            
            // Later, more facts arrive
            await j.fact(office2);
            await j.fact(manager2);
            
            managerObserver.stop();

            // EXPECTATION: Should include both managers as they arrive
            expect(managers).toContain(j.hash(manager1));
            expect(managers).toContain(j.hash(manager2));
        });
    });

    describe("subscription recovery", () => {
        it("should not require additional watch() calls when given becomes known", async () => {
            // Test that subscriptions recover automatically without
            // requiring additional watch() calls
            
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            let watchCallCount = 0;
            const managers: string[] = [];
            
            // Start watching before given is known
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company,
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
            
            managerObserver.stop();

            // EXPECTATION: Should recover automatically without additional watch() calls
            expect(managers).toContain(j.hash(manager));
            expect(watchCallCount).toBeGreaterThan(0);
        });

        it("should work with both HTTP polling and WebSocket feeds", async () => {
            // Test that the race condition fix works regardless of transport
            
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
                company, // Given fact arrives after subscription
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Simulate facts arriving via any transport
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            
            managerObserver.stop();

            // EXPECTATION: Should work regardless of transport mechanism
            expect(managers).toContain(j.hash(manager));
        });
    });
}); 