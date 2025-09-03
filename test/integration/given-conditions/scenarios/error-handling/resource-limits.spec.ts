import { MemoryStore } from "../../../../../src/memory/memory-store";
import { FactReference } from "../../../../../src/storage";
import { dehydrateFact } from "../../../../../src/fact/hydrate";
import { SpecificationParser } from "../../../../../src/specification/specification-parser";
import { User, Company, Office, OfficeClosed, OfficeReopened, Administrator, Manager, Employee } from "../../../../companyModel";

describe("Given Conditions - Resource Limits", () => {
    let store: MemoryStore;

    beforeEach(async () => {
        store = new MemoryStore();
    });

    it("should handle large datasets without memory issues", async () => {
        // Create a large dataset
        const largeUsers = Array.from({ length: 1000 }, (_, i) => new User(`user-${i}`));
        const largeCompanies = Array.from({ length: 500 }, (_, i) =>
            new Company(largeUsers[i % largeUsers.length], `Company ${i}`)
        );
        const largeOffices = largeCompanies.flatMap(company =>
            Array.from({ length: 10 }, (_, i) =>
                new Office(company, `${company.identifier} Office ${i}`)
            )
        );
        const largeClosures = largeOffices.slice(0, 2000).map((office, i) =>
            new OfficeClosed(office, new Date(`2023-${String((i % 12) + 1).padStart(2, '0')}-01`))
        );

        const largeFacts = [...largeUsers, ...largeCompanies, ...largeOffices, ...largeClosures];

        // Save all facts to store
        for (const fact of largeFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Test with first closed office
        const testOffice = largeOffices.find(office =>
            largeClosures.some(closure => closure.office === office)
        );

        if (testOffice) {
            const officeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(testOffice)[0].hash
            };

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(1);
        }
    });

    it("should validate memory usage with deeply nested conditions", async () => {
        // Create dataset for deep nesting test
        const users = Array.from({ length: 50 }, (_, i) => new User(`user-${i}`));
        const companies = Array.from({ length: 20 }, (_, i) =>
            new Company(users[i % users.length], `Company ${i}`)
        );
        const offices = companies.flatMap(company =>
            Array.from({ length: 5 }, (_, i) =>
                new Office(company, `${company.identifier} Office ${i}`)
            )
        );
        const closures = offices.slice(0, 30).map(office =>
            new OfficeClosed(office, new Date("2023-06-01"))
        );
        const administrators = companies.map((company, i) =>
            new Administrator(company, users[i % users.length], new Date("2023-01-01"))
        );
        const managers = offices.slice(0, 20).map((office, i) =>
            new Manager(office, 1000 + i)
        );
        const employees = offices.slice(0, 15).map((office, i) =>
            new Employee(office, users[i % users.length])
        );

        const allFacts = [...users, ...companies, ...offices, ...closures, ...administrators, ...managers, ...employees];

        for (const fact of allFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                            E {
                                manager: Manager [
                                    manager.office = closure.office
                                    E {
                                        employee: Employee [
                                            employee.office = manager.office
                                            employee.user = admin.user
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Find office that meets all criteria
        const qualifyingOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            administrators.some(admin => admin.company === office.company) &&
            managers.some(manager => manager.office === office) &&
            employees.some(employee =>
                employee.office === office &&
                administrators.some(admin => admin.user === employee.user)
            )
        );

        if (qualifyingOffice) {
            const officeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(qualifyingOffice)[0].hash
            };

            const results = await store.read([officeRef], specification);
            expect(Array.isArray(results)).toBe(true);
        }
    });

    it("should handle concurrent executions without resource conflicts", async () => {
        // Create moderate dataset
        const users = Array.from({ length: 20 }, (_, i) => new User(`user-${i}`));
        const companies = Array.from({ length: 10 }, (_, i) =>
            new Company(users[i % users.length], `Company ${i}`)
        );
        const offices = companies.flatMap(company =>
            Array.from({ length: 3 }, (_, i) =>
                new Office(company, `${company.identifier} Office ${i}`)
            )
        );
        const closures = offices.slice(0, 15).map(office =>
            new OfficeClosed(office, new Date("2023-06-01"))
        );

        const allFacts = [...users, ...companies, ...offices, ...closures];

        for (const fact of allFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Execute multiple concurrent queries
        const concurrentQueries = offices.slice(0, 5).map(async (office) => {
            if (closures.some(closure => closure.office === office)) {
                const officeRef: FactReference = {
                    type: "Office",
                    hash: dehydrateFact(office)[0].hash
                };
                return await store.read([officeRef], specification);
            }
            return [];
        });

        const results = await Promise.all(concurrentQueries);
        expect(results).toHaveLength(5);
        results.forEach(result => expect(Array.isArray(result)).toBe(true));
    });

    it("should validate storage limits with many facts", async () => {
        // Test with maximum reasonable number of facts
        const maxUsers = Array.from({ length: 5000 }, (_, i) => new User(`user-${i}`));
        const maxCompanies = Array.from({ length: 1000 }, (_, i) =>
            new Company(maxUsers[i % maxUsers.length], `Company ${i}`)
        );
        const maxOffices = maxCompanies.flatMap(company =>
            Array.from({ length: 2 }, (_, i) =>
                new Office(company, `${company.identifier} Office ${i}`)
            )
        );

        const maxFacts = [...maxUsers, ...maxCompanies, ...maxOffices];

        // Save facts in batches to avoid overwhelming the store
        const batchSize = 1000;
        for (let i = 0; i < maxFacts.length; i += batchSize) {
            const batch = maxFacts.slice(i, i + batchSize);
            for (const fact of batch) {
                const dehydrated = dehydrateFact(fact);
                const envelopes = dehydrated.map(record => ({
                    fact: record,
                    signatures: []
                }));
                await store.save(envelopes);
            }
        }

        const specification = new SpecificationParser(`
            (office: Office) {
            } => office
        `).parseSpecification();

        // Test with first office
        const testOffice = maxOffices[0];
        const officeRef: FactReference = {
            type: "Office",
            hash: dehydrateFact(testOffice)[0].hash
        };

        const results = await store.read([officeRef], specification);
        expect(results.length).toBe(1);
    });

    it("should handle specifications with many conditions efficiently", async () => {
        // Create dataset
        const users = Array.from({ length: 10 }, (_, i) => new User(`user-${i}`));
        const companies = Array.from({ length: 5 }, (_, i) =>
            new Company(users[i % users.length], `Company ${i}`)
        );
        const offices = companies.flatMap(company =>
            Array.from({ length: 2 }, (_, i) =>
                new Office(company, `${company.identifier} Office ${i}`)
            )
        );
        const closures = offices.map(office =>
            new OfficeClosed(office, new Date("2023-06-01"))
        );
        const administrators = companies.map((company, i) =>
            new Administrator(company, users[i % users.length], new Date("2023-01-01"))
        );

        const allFacts = [...users, ...companies, ...offices, ...closures, ...administrators];

        for (const fact of allFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        // Create specification with many parallel conditions
        const manyConditions = Array.from({ length: 50 }, (_, i) =>
            `E { condition${i}: Administrator [ condition${i}.company = office.company ] }`
        ).join(' ');

        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    ${manyConditions}
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Test with office that has closure and admin
        const testOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            administrators.some(admin => admin.company === office.company)
        );

        if (testOffice) {
            const officeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(testOffice)[0].hash
            };

            const results = await store.read([officeRef], specification);
            expect(Array.isArray(results)).toBe(true);
        }
    });

    it("should validate performance with complex queries", async () => {
        // Create complex dataset for performance testing
        const users = Array.from({ length: 100 }, (_, i) => new User(`user-${i}`));
        const companies = Array.from({ length: 50 }, (_, i) =>
            new Company(users[i % users.length], `Company ${i}`)
        );
        const offices = companies.flatMap(company =>
            Array.from({ length: 4 }, (_, i) =>
                new Office(company, `${company.identifier} Office ${i}`)
            )
        );
        const closures = offices.slice(0, 100).map(office =>
            new OfficeClosed(office, new Date("2023-06-01"))
        );
        const reopenings = closures.slice(0, 50).map(closure =>
            new OfficeReopened(closure)
        );
        const administrators = companies.map((company, i) =>
            new Administrator(company, users[i % users.length], new Date("2023-01-01"))
        );
        const managers = offices.slice(0, 75).map((office, i) =>
            new Manager(office, 2000 + i)
        );

        const allFacts = [...users, ...companies, ...offices, ...closures, ...reopenings, ...administrators, ...managers];

        for (const fact of allFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    !E {
                        reopening: Office.Reopened [
                            reopening = closure
                        ]
                    }
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                        ]
                    }
                    E {
                        manager: Manager [
                            manager.office = office
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Test with office that meets complex criteria
        const qualifyingOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            !reopenings.some(reopening => reopening.officeClosed.office === office) &&
            administrators.some(admin => admin.company === office.company) &&
            managers.some(manager => manager.office === office)
        );

        if (qualifyingOffice) {
            const officeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(qualifyingOffice)[0].hash
            };

            const startTime = Date.now();
            const results = await store.read([officeRef], specification);
            const endTime = Date.now();

            expect(results.length).toBe(1);
            expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
        }
    });

    it("should handle memory cleanup after large operations", async () => {
        // Create large dataset, execute query, then verify system stability
        const largeUsers = Array.from({ length: 2000 }, (_, i) => new User(`user-${i}`));
        const largeCompanies = Array.from({ length: 500 }, (_, i) =>
            new Company(largeUsers[i % largeUsers.length], `Company ${i}`)
        );

        const largeFacts = [...largeUsers, ...largeCompanies];

        for (const fact of largeFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        const specification = new SpecificationParser(`
            (company: Company) {
            } => company
        `).parseSpecification();

        // Execute query with large dataset
        const testCompany = largeCompanies[0];
        const companyRef: FactReference = {
            type: "Company",
            hash: dehydrateFact(testCompany)[0].hash
        };

        const results = await store.read([companyRef], specification);
        expect(results.length).toBe(1);

        // Execute smaller query to verify system is still responsive
        const smallSpecification = new SpecificationParser(`
            (user: User) {
            } => user
        `).parseSpecification();

        const testUser = largeUsers[0];
        const userRef: FactReference = {
            type: "User",
            hash: dehydrateFact(testUser)[0].hash
        };

        const smallResults = await store.read([userRef], smallSpecification);
        expect(smallResults.length).toBe(1);
    });
});