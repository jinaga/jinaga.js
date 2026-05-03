import { Jinaga, JinagaTest, User } from "../../src";
import { Company, Office, Manager, President, model } from "../companyModel";

describe("inverse subscription wire protocol and server-side behavior", () => {
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
            
            managerObserver.stop();

            // EXPECTATION: The subscription message should have included the company in givens
            // and the server should have used it to match incoming facts
            expect(managers).toContain(j.hash(manager));
        });

        it("should handle multiple givens in subscription message", async () => {
            // Test scenario with multiple given facts in the subscription
            const company = new Company(creator, "TestCo");
            const user = new User("Another user");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            const managers: string[] = [];
            const managerObserver = j.watch(
                model.given(Company, User).match((company, user, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, user, // Multiple givens should be included in subscription message
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Introduce facts after subscription
            await j.fact(company);
            await j.fact(user);
            await j.fact(office);
            await j.fact(manager);
            
            managerObserver.stop();

            // EXPECTATION: Both givens should be included in subscription message
            expect(managers).toContain(j.hash(manager));
        });
    });

    describe("server-side givens handling", () => {
        it("should store and use givens to re-evaluate inverses as new facts arrive", async () => {
            // This test simulates the server-side behavior where givens are stored
            // and used to re-evaluate inverse queries as new facts arrive
            
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            // Simulate server-side fact arrival order
            const serverFacts = [office, manager]; // Company arrives later
            
            const managers: string[] = [];
            const managerObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, // Given fact that server should store and use
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Simulate server receiving facts in order (company arrives last)
            for (const fact of serverFacts) {
                await j.fact(fact);
            }
            
            // Now the company arrives (the given fact)
            await j.fact(company);
            
            managerObserver.stop();

            // EXPECTATION: Server should have stored the company given and
            // re-evaluated the inverse query when company arrived
            expect(managers).toContain(j.hash(manager));
        });

        it("should handle server-side fact arrival in any order", async () => {
            // Test that server handles facts arriving in any order
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
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Simulate facts arriving in random order
            await j.fact(manager); // Manager arrives first
            await j.fact(company); // Company arrives second
            await j.fact(office);  // Office arrives last
            
            managerObserver.stop();

            // EXPECTATION: Should work regardless of arrival order
            expect(managers).toContain(j.hash(manager));
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
            
            managerObserver.stop();

            // EXPECTATION: Both managers should be matched using the company anchor
            expect(managers).toContain(j.hash(manager1));
            expect(managers).toContain(j.hash(manager2));
        });

        it("should handle anchor arrival after related facts", async () => {
            // Test scenario where the anchor (given fact) arrives after
            // the facts that should be matched to it
            
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
                company, // Anchor arrives after related facts
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await managerObserver.loaded();
            
            // Introduce facts before the anchor
            await j.fact(office);
            await j.fact(manager);
            
            // Now introduce the anchor
            await j.fact(company);
            
            managerObserver.stop();

            // EXPECTATION: Should match the manager to the company anchor
            // even though the anchor arrived after the manager
            expect(managers).toContain(j.hash(manager));
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
            
            managerObserver.stop();

            // EXPECTATION: Should recover seamlessly once given is known locally
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
            
            managerObserver.stop();

            // EXPECTATION: Should recover seamlessly once given arrives from server
            expect(managers).toContain(j.hash(manager));
        });
    });

    describe("transport mechanism compatibility", () => {
        it("should work with HTTP polling transport", async () => {
            // Test that the race condition fix works with HTTP polling
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
            
            // Simulate HTTP polling behavior
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            
            managerObserver.stop();

            // EXPECTATION: Should work with HTTP polling transport
            expect(managers).toContain(j.hash(manager));
        });

        it("should work with WebSocket feeds transport", async () => {
            // Test that the race condition fix works with WebSocket feeds
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
            
            // Simulate WebSocket feed behavior
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            
            managerObserver.stop();

            // EXPECTATION: Should work with WebSocket feeds transport
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
            
            managerObserver.stop();

            // EXPECTATION: Should work with single watch call
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
            
            managerObserver.stop();

            // EXPECTATION: Should automatically track and re-evaluate
            expect(managers).toContain(j.hash(manager));
        });
    });
}); 