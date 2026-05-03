import { Jinaga, JinagaTest, User } from "../../src";
import { Company, Office, Manager, President, ManagerName, model } from "../companyModel";

describe("advanced inverse subscription race condition scenarios", () => {
    let creator: User;
    let j: Jinaga;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        j = JinagaTest.create({
            initialState: []
        });
    });

    describe("complex inverse relationships", () => {
        it("should handle multi-level inverse relationships with late givens", async () => {
            // Test Company -> Office -> Manager -> ManagerName chain
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            const managerName = new ManagerName(manager, "John Doe", []);
            
            const managerNames: string[] = [];
            const nameObserver = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .selectMany(manager => facts.ofType(ManagerName)
                                .join(name => name.manager, manager)
                            )
                        )
                ),
                company, // Given fact arrives after subscription
                managerName => {
                    managerNames.push(j.hash(managerName));
                }
            );

            await nameObserver.loaded();
            
            // Introduce facts in order
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            await j.fact(managerName);
            
            nameObserver.stop();

            // EXPECTATION: Should include the manager name
            expect(managerNames).toContain(j.hash(managerName));
        });

        it("should handle multiple inverse paths to the same fact", async () => {
            // Test scenario where a fact can be reached through multiple inverse paths
            const company = new Company(creator, "TestCo");
            const office1 = new Office(company, "Office1");
            const office2 = new Office(company, "Office2");
            const manager = new Manager(office1, 123);
            const president = new President(office2, creator);
            
            const allPeople: string[] = [];
            
            // Watch for managers
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
                    allPeople.push(j.hash(manager));
                }
            );

            // Watch for presidents
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
                    allPeople.push(j.hash(president));
                }
            );

            await managerObserver.loaded();
            await presidentObserver.loaded();
            
            // Introduce facts
            await j.fact(company);
            await j.fact(office1);
            await j.fact(office2);
            await j.fact(manager);
            await j.fact(president);
            
            managerObserver.stop();
            presidentObserver.stop();

            // EXPECTATION: Should include both manager and president
            expect(allPeople).toContain(j.hash(manager));
            expect(allPeople).toContain(j.hash(president));
        });
    });

    describe("concurrent subscription scenarios", () => {
        it("should handle multiple concurrent subscriptions with different givens", async () => {
            // Test multiple subscriptions started simultaneously with different givens
            const company1 = new Company(creator, "Company1");
            const company2 = new Company(creator, "Company2");
            const office1 = new Office(company1, "Office1");
            const office2 = new Office(company2, "Office2");
            const manager1 = new Manager(office1, 123);
            const manager2 = new Manager(office2, 456);
            
            const managers1: string[] = [];
            const managers2: string[] = [];
            
            // Start both subscriptions before any facts are known
            const observer1 = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company1,
                manager => {
                    managers1.push(j.hash(manager));
                }
            );

            const observer2 = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company2,
                manager => {
                    managers2.push(j.hash(manager));
                }
            );

            await observer1.loaded();
            await observer2.loaded();
            
            // Introduce facts for both companies
            await j.fact(company1);
            await j.fact(company2);
            await j.fact(office1);
            await j.fact(office2);
            await j.fact(manager1);
            await j.fact(manager2);
            
            observer1.stop();
            observer2.stop();

            // EXPECTATION: Each observer should see only its respective managers
            expect(managers1).toContain(j.hash(manager1));
            expect(managers1).not.toContain(j.hash(manager2));
            expect(managers2).toContain(j.hash(manager2));
            expect(managers2).not.toContain(j.hash(manager1));
        });

        it("should handle subscription cancellation and restart", async () => {
            // Test scenario where subscription is cancelled and restarted
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            const managers: string[] = [];
            
            // Start subscription
            const observer = j.watch(
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

            await observer.loaded();
            
            // Cancel subscription before facts arrive
            observer.stop();
            
            // Introduce facts after cancellation
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            
            // Restart subscription
            const managers2: string[] = [];
            const observer2 = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company,
                manager => {
                    managers2.push(j.hash(manager));
                }
            );

            await observer2.loaded();
            observer2.stop();

            // EXPECTATION: First observer should see nothing (cancelled)
            // Second observer should see the manager
            expect(managers).toEqual([]);
            expect(managers2).toContain(j.hash(manager));
        });
    });

    describe("error handling scenarios", () => {
        it("should handle invalid given facts gracefully", async () => {
            // Test scenario where given fact is invalid or malformed
            const invalidCompany = { type: "InvalidCompany" } as any;
            
            const managers: string[] = [];
            const observer = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                invalidCompany,
                manager => {
                    managers.push(j.hash(manager));
                }
            );

            await observer.loaded();
            
            // EXPECTATION: Should handle gracefully without throwing
            expect(() => observer.stop()).not.toThrow();
        });

        it("should handle missing predecessor relationships", async () => {
            // Test scenario where facts have missing predecessor relationships
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            // Create a manager without proper office relationship
            const orphanedManager = new Manager(null as any, 456);
            
            const managers: string[] = [];
            const observer = j.watch(
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

            await observer.loaded();
            
            // Introduce facts including orphaned manager
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            await j.fact(orphanedManager);
            
            observer.stop();

            // EXPECTATION: Should only include properly related managers
            expect(managers).toContain(j.hash(manager));
            expect(managers).not.toContain(j.hash(orphanedManager));
        });
    });

    describe("performance and scalability", () => {
        it("should handle large numbers of facts efficiently", async () => {
            // Test scenario with many facts to ensure performance
            const company = new Company(creator, "TestCo");
            const offices: Office[] = [];
            const managers: Manager[] = [];
            
            // Create many offices and managers
            for (let i = 0; i < 10; i++) {
                const office = new Office(company, `Office${i}`);
                offices.push(office);
                
                for (let j = 0; j < 5; j++) {
                    const manager = new Manager(office, i * 100 + j);
                    managers.push(manager);
                }
            }
            
            const allManagers: string[] = [];
            const observer = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company, // Given fact arrives after subscription
                manager => {
                    allManagers.push(j.hash(manager));
                }
            );

            await observer.loaded();
            
            // Introduce all facts
            await j.fact(company);
            for (const office of offices) {
                await j.fact(office);
            }
            for (const manager of managers) {
                await j.fact(manager);
            }
            
            observer.stop();

            // EXPECTATION: Should include all managers efficiently
            expect(allManagers).toHaveLength(50); // 10 offices * 5 managers each
            for (const manager of managers) {
                expect(allManagers).toContain(j.hash(manager));
            }
        });

        it("should handle rapid fact introduction", async () => {
            // Test scenario where facts are introduced rapidly
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const managers = Array.from({ length: 20 }, (_, i) => 
                new Manager(office, i)
            );
            
            const allManagers: string[] = [];
            const observer = j.watch(
                model.given(Company).match((company, facts) =>
                    facts.ofType(Office)
                        .join(office => office.company, company)
                        .selectMany(office => facts.ofType(Manager)
                            .join(manager => manager.office, office)
                        )
                ),
                company,
                manager => {
                    allManagers.push(j.hash(manager));
                }
            );

            await observer.loaded();
            
            // Introduce facts rapidly
            await j.fact(company);
            await j.fact(office);
            
            // Introduce all managers rapidly
            const promises = managers.map(manager => j.fact(manager));
            await Promise.all(promises);
            
            observer.stop();

            // EXPECTATION: Should handle rapid introduction without issues
            expect(allManagers).toHaveLength(20);
            for (const manager of managers) {
                expect(allManagers).toContain(j.hash(manager));
            }
        });
    });

    describe("edge cases and boundary conditions", () => {
        it("should handle empty result sets correctly", async () => {
            // Test scenario where no facts match the specification
            const company = new Company(creator, "TestCo");
            
            const managers: string[] = [];
            const observer = j.watch(
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

            await observer.loaded();
            
            // Only introduce company, no offices or managers
            await j.fact(company);
            
            observer.stop();

            // EXPECTATION: Should handle empty results gracefully
            expect(managers).toEqual([]);
        });

        it("should handle circular reference scenarios", async () => {
            // Test scenario that might create circular references
            const company = new Company(creator, "TestCo");
            const office = new Office(company, "TestOffice");
            const manager = new Manager(office, 123);
            
            const managers: string[] = [];
            const observer = j.watch(
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

            await observer.loaded();
            
            // Introduce facts in a way that might create circular references
            await j.fact(company);
            await j.fact(office);
            await j.fact(manager);
            
            observer.stop();

            // EXPECTATION: Should handle without infinite loops
            expect(managers).toContain(j.hash(manager));
        });
    });
}); 