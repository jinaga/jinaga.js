import 'fake-indexeddb/auto';
import { Authentication } from '../../src/authentication/authentication';
import { AuthenticationTest } from '../../src/authentication/authentication-test';
import { AuthorizationRules } from '../../src/authorization/authorizationRules';
import { DistributionEngine } from '../../src/distribution/distribution-engine';
import { DistributionRules } from '../../src/distribution/distribution-rules';
import { dehydrateFact, Dehydration } from '../../src/fact/hydrate';
import { PassThroughFork } from '../../src/fork/pass-through-fork';
import { SyncStatusNotifier } from '../../src/http/web-client';
import { IndexedDBStore } from '../../src/indexeddb/indexeddb-store';
import { Jinaga } from '../../src/jinaga';
import { FactManager } from '../../src/managers/factManager';
import { Network, NetworkDistribution, NetworkNoOp } from '../../src/managers/NetworkManager';
import { ObservableSource } from '../../src/observable/observable';
import { PurgeConditions } from '../../src/purge/purgeConditions';
import { Model } from '../../src/specification/model';
import { Specification } from '../../src/specification/specification';
import { FactEnvelope, Storage } from '../../src/storage';
import { User } from '../../src/model/user';
import { Company, Manager, ManagerName, Office, model } from '../companyModel';

const isIndexedDBAvailable = typeof indexedDB !== 'undefined';
const describeFunc = isIndexedDBAvailable ? describe : describe.skip;

export type JinagaIndexedDBTestConfig = {
    model?: Model,
    authorization?: (a: AuthorizationRules) => AuthorizationRules,
    distribution?: (d: DistributionRules) => DistributionRules,
    user?: {},
    device?: {},
    initialState?: {}[],
    purgeConditions?: (p: PurgeConditions) => PurgeConditions,
    feedRefreshIntervalSeconds?: number,
    dbName: string
}

export class JinagaIndexedDBTest {
    static async create(config: JinagaIndexedDBTestConfig) {
        const store = new IndexedDBStore(config.dbName);
        await this.saveInitialState(config, store);
        const observableSource = new ObservableSource(store);
        const syncStatusNotifier = new SyncStatusNotifier();
        const fork = new PassThroughFork(store);
        const authentication = this.createAuthentication(config, store);
        const network = this.createNetwork(config, store);
        const purgeConditions = this.createPurgeConditions(config);
        const factManager = new FactManager(fork, observableSource, store, network, purgeConditions, config.feedRefreshIntervalSeconds);
        return new Jinaga(authentication, factManager, syncStatusNotifier);
    }

    static async saveInitialState(config: JinagaIndexedDBTestConfig, store: IndexedDBStore) {
        if (config.initialState) {
            const dehydrate = new Dehydration();
            config.initialState.forEach(obj => dehydrate.dehydrate(obj));
            await store.save(dehydrate.factRecords().map(f => <FactEnvelope>{
                fact: f,
                signatures: []
            }));
        }
    }

    static createAuthentication(config: JinagaIndexedDBTestConfig, store: Storage): Authentication {
        const authorizationRules = config.authorization ?
            config.authorization(new AuthorizationRules(config.model)) : null;
        const userFact = JinagaIndexedDBTest.getUserFact(config);
        const deviceFact = JinagaIndexedDBTest.getDeviceFact(config);
        
        return new AuthenticationTest(store, authorizationRules, userFact, deviceFact);
    }

    static createNetwork(config: JinagaIndexedDBTestConfig, store: Storage): Network {
        if (config.distribution) {
            const distributionRules = config.distribution(new DistributionRules([]));
            const distributionEngine = new DistributionEngine(distributionRules, store, true);
            return new NetworkDistribution(distributionEngine, this.getUserFact(config));
        }
        else {
            return new NetworkNoOp();
        }
    }

    static createPurgeConditions(config: JinagaIndexedDBTestConfig): Specification[] {
        if (config.purgeConditions) {
            return config.purgeConditions(new PurgeConditions([])).specifications;
        }
        else {
            return [];
        }
    }

    private static getUserFact(config: JinagaIndexedDBTestConfig) {
        return config.user ? dehydrateFact(config.user)[0] : null;
    }

    private static getDeviceFact(config: JinagaIndexedDBTestConfig) {
        return config.device ? dehydrateFact(config.device)[0] : null;
    }
}

describeFunc("IndexedDB Watch Integration", () => {
    let j: Jinaga;
    let creator: User;
    let company: Company;
    let office: Office;
    let dbName: string;

    beforeEach(async () => {
        if (!isIndexedDBAvailable) {
            return;
        }

        // Use a unique database name for each test run
        dbName = `test-indexeddb-watch-${Date.now()}-${Math.random()}`;
        
        // Create facts
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");

        // Create Jinaga instance with IndexedDBStore
        j = await JinagaIndexedDBTest.create({
            dbName,
            model,
            initialState: [
                creator,
                company,
                office
            ]
        });
    });

    afterEach(async () => {
        if (!isIndexedDBAvailable || !dbName) {
            return;
        }

        // Stop any observers that might be holding database connections
        // Note: observers are stopped in individual tests, but we ensure cleanup here

        // Wait a bit for any async operations to complete
        await new Promise(resolve => setTimeout(resolve, 50));

        // Clean up the IndexedDB database
        const deleteRequest = indexedDB.deleteDatabase(dbName);
        await new Promise((resolve, reject) => {
            deleteRequest.onsuccess = () => resolve(undefined);
            deleteRequest.onerror = () => reject(deleteRequest.error);
            deleteRequest.onblocked = () => {
                // If blocked, wait a bit longer and try to resolve
                setTimeout(() => resolve(undefined), 100);
            };
        });
    });

    it("should notify results when they previously existed", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const offices: string[] = [];
        const officeObserver = j.watch(specification, company, office => {
            offices.push(j.hash(office));
        });

        await officeObserver.loaded();
        officeObserver.stop();

        expect(offices).toEqual([j.hash(office)]);
    });

    it("should notify results when added after watch starts", async () => {
        const emptyCompany = new Company(creator, "EmptyCo");
        await j.fact(emptyCompany);

        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const offices: string[] = [];
        const officeObserver = j.watch(specification, emptyCompany, office => {
            offices.push(j.hash(office));
        });

        await officeObserver.loaded();
        
        // Add office after watch is loaded
        const newOffice = new Office(emptyCompany, "NewOffice");
        await j.fact(newOffice);
        
        // Wait for notifications to process
        await officeObserver.processed();
        
        officeObserver.stop();

        expect(offices).toEqual([j.hash(newOffice)]);
    });

    it("should notify nested collection results when added", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier,
                    managers: facts.ofType(Manager)
                        .join(manager => manager.office, office)
                }))
        );

        const offices: {
            identifier: string,
            managers: string[]
        }[] = [];
        
        const officeObserver = j.watch(specification, company, office => {
            const model = {
                identifier: office.identifier,
                managers: [] as string[]
            };
            offices.push(model);
            
            office.managers.onAdded(manager => {
                model.managers.push(j.hash(manager));
            });
        });

        await officeObserver.loaded();
        
        // Add manager after watch is loaded
        const manager = new Manager(office, 1001);
        await j.fact(manager);
        
        // Wait for notifications to process
        await officeObserver.processed();
        
        officeObserver.stop();

        expect(offices).toHaveLength(1);
        expect(offices[0].identifier).toBe(office.identifier);
        expect(offices[0].managers).toEqual([j.hash(manager)]);
    });

    it("should handle basic mutable property update", async () => {
        // Create manager first
        const manager = new Manager(office, 2001);
        await j.fact(manager);

        // Create initial name
        const name1 = new ManagerName(manager, "Alice", []);
        await j.fact(name1);

        // Watch for current names (using notExists pattern to find names with no successors)
        const specification = model.given(Manager).match((manager, facts) =>
            facts.ofType(ManagerName)
                .join(name => name.manager, manager)
                .notExists(name => facts.ofType(ManagerName)
                    .join(next => next.manager, manager)
                    .join(next => next.prior, name)
                )
                .select(name => name.value)
        );

        const names: string[] = [];
        const nameObserver = j.watch(specification, manager, name => {
            names.push(name);
            return () => {
                names.splice(names.indexOf(name), 1);
            };
        });

        await nameObserver.loaded();
        
        // Initially should have "Alice"
        expect(names).toEqual(["Alice"]);

        // Add new name with prior
        const name2 = new ManagerName(manager, "Bob", [name1]);
        await j.fact(name2);
        
        // Wait for notifications to process
        await nameObserver.processed();
        
        nameObserver.stop();

        // Should now show "Bob" as current (Alice is removed when Bob replaces it)
        expect(names).toEqual(["Bob"]);
    });

    it("should handle mutable property with multiple concurrent values", async () => {
        // Create manager first
        const manager = new Manager(office, 3001);
        await j.fact(manager);

        // Create initial name
        const name1 = new ManagerName(manager, "Alice", []);
        await j.fact(name1);

        // Create second name
        const name2 = new ManagerName(manager, "Bob", [name1]);
        await j.fact(name2);

        // Add two names simultaneously with the same prior (name2)
        const name3 = new ManagerName(manager, "Charlie", [name2]);
        const name4 = new ManagerName(manager, "David", [name2]);
        
        // Watch for current names before adding name3 and name4
        const specification = model.given(Manager).match((manager, facts) =>
            facts.ofType(ManagerName)
                .join(name => name.manager, manager)
                .notExists(name => facts.ofType(ManagerName)
                    .join(next => next.manager, manager)
                    .join(next => next.prior, name)
                )
                .select(name => name.value)
        );

        const names: string[] = [];
        const nameObserver = j.watch(specification, manager, name => {
            names.push(name);
            return () => {
                names.splice(names.indexOf(name), 1);
            };
        });

        await nameObserver.loaded();
        
        // Initially should have "Bob" as current
        expect(names).toEqual(["Bob"]);

        // Add both name3 and name4 simultaneously (both have same prior: name2)
        await j.fact(name3);
        await j.fact(name4);
        
        // Wait for notifications to process
        await nameObserver.processed();
        
        nameObserver.stop();

        // Both name3 and name4 should be current (both have same prior, no successors)
        // Bob should be removed since it now has successors
        expect(names).toContain("Charlie");
        expect(names).toContain("David");
        expect(names).not.toContain("Bob");
        expect(names.length).toBe(2);
    });

    it("should handle mutable property set arriving after watch", async () => {
        // Create manager first
        const manager = new Manager(office, 4001);
        await j.fact(manager);

        // Watch for current names before any name exists
        const specification = model.given(Manager).match((manager, facts) =>
            facts.ofType(ManagerName)
                .join(name => name.manager, manager)
                .notExists(name => facts.ofType(ManagerName)
                    .join(next => next.manager, manager)
                    .join(next => next.prior, name)
                )
                .select(name => name.value)
        );

        const names: string[] = [];
        const nameObserver = j.watch(specification, manager, name => {
            names.push(name);
            return () => {
                names.splice(names.indexOf(name), 1);
            }
        });

        await nameObserver.loaded();
        
        // Initially should be empty
        expect(names).toEqual([]);

        // Add name1: "Alice"
        const name1 = new ManagerName(manager, "Alice", []);
        await j.fact(name1);
        await nameObserver.processed();
        
        // Verify watch receives "Alice"
        expect(names).toEqual(["Alice"]);

        // Add name2: "Bob" with prior: [name1]
        const name2 = new ManagerName(manager, "Bob", [name1]);
        await j.fact(name2);
        await nameObserver.processed();
        
        // Verify watch updates to show "Bob"
        expect(names).toEqual(["Bob"]);

        // Add name3 and name4 simultaneously with same prior: [name2]
        const name3 = new ManagerName(manager, "Charlie", [name2]);
        const name4 = new ManagerName(manager, "David", [name2]);
        await j.fact(name3);
        await j.fact(name4);
        await nameObserver.processed();
        
        nameObserver.stop();

        // Verify watch receives both name3 and name4 as current
        expect(names).toEqual(["Charlie", "David"]);
    });

    it("should handle mutable property updates arriving after watch", async () => {
        // Create manager first
        const manager = new Manager(office, 4001);
        await j.fact(manager);

        // Add name1: "Alice"
        const name1 = new ManagerName(manager, "Alice", []);
        await j.fact(name1);

        // Watch for current names before any name exists
        const specification = model.given(Manager).match((manager, facts) =>
            facts.ofType(ManagerName)
                .join(name => name.manager, manager)
                .notExists(name => facts.ofType(ManagerName)
                    .join(next => next.manager, manager)
                    .join(next => next.prior, name)
                )
                .select(name => name.value)
        );

        const names: string[] = [];
        const nameObserver = j.watch(specification, manager, name => {
            names.push(name);
            return () => {
                names.splice(names.indexOf(name), 1);
            }
        });

        await nameObserver.loaded();
        
        // Initially should be "Alice"
        expect(names).toEqual(["Alice"]);

        // Add name2: "Bob" with prior: [name1]
        const name2 = new ManagerName(manager, "Bob", [name1]);
        await j.fact(name2);
        await nameObserver.processed();
        
        // Verify watch updates to show "Bob"
        expect(names).toEqual(["Bob"]);

        // Add name3 and name4 simultaneously with same prior: [name2]
        const name3 = new ManagerName(manager, "Charlie", [name2]);
        const name4 = new ManagerName(manager, "David", [name2]);
        await j.fact(name3);
        await j.fact(name4);
        await nameObserver.processed();
        
        nameObserver.stop();

        // Verify watch receives both name3 and name4 as current
        expect(names).toEqual(["Charlie", "David"]);
    });

    it("should handle mutable property with nested watch", async () => {
        // Create a new office for this test (not in initialState)
        const newOffice = new Office(company, "NewOffice");
        await j.fact(newOffice);

        // Watch for managers with their current names (nested)
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Manager)
                .join(manager => manager.office, office)
                .select(manager => ({
                    manager: manager,
                    names: facts.ofType(ManagerName)
                        .join(name => name.manager, manager)
                        .notExists(name => facts.ofType(ManagerName)
                            .join(next => next.manager, manager)
                            .join(next => next.prior, name)
                        )
                        .select(name => name.value)
                }))
        );

        const managers: {
            manager: Manager,
            names: string[]
        }[] = [];
        
        const managerObserver = j.watch(specification, newOffice, manager => {
            const model = {
                manager: manager.manager,
                names: [] as string[]
            };
            managers.push(model);
            
            manager.names.onAdded(name => {
                model.names.push(name);
                return () => {
                    const index = model.names.indexOf(name);
                    if (index > -1) {
                        model.names.splice(index, 1);
                    }
                };
            });
        });

        await managerObserver.loaded();
        
        // Initially should be empty
        expect(managers).toEqual([]);

        // Add manager
        const manager = new Manager(newOffice, 5001);
        await j.fact(manager);
        await managerObserver.processed();
        
        // Add name1
        const name1 = new ManagerName(manager, "Alice", []);
        await j.fact(name1);
        await managerObserver.processed();
        
        // Verify nested watch shows manager with name1
        expect(managers).toHaveLength(1);
        expect(managers[0].names).toEqual(["Alice"]);

        // Add name2 and name3 simultaneously with same prior: [name1]
        const name2 = new ManagerName(manager, "Bob", [name1]);
        const name3 = new ManagerName(manager, "Charlie", [name1]);
        await j.fact(name2);
        await j.fact(name3);
        await managerObserver.processed();
        
        managerObserver.stop();

        // Verify nested watch shows manager with both name2 and name3
        // Alice should be removed since it now has successors (name2 and name3)
        expect(managers).toHaveLength(1);
        expect(managers[0].names).toContain("Bob");
        expect(managers[0].names).toContain("Charlie");
        expect(managers[0].names).not.toContain("Alice");
        expect(managers[0].names.length).toBe(2);
    });

    it("should handle rapid sequential fact additions", async () => {
        const newCompany = new Company(creator, "RapidCo");
        await j.fact(newCompany);

        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const offices: string[] = [];
        const officeObserver = j.watch(specification, newCompany, office => {
            offices.push(j.hash(office));
        });

        await officeObserver.loaded();
        
        // Initially should be empty
        expect(offices).toEqual([]);

        // Add multiple offices in quick succession
        const office1 = new Office(newCompany, "Office1");
        const office2 = new Office(newCompany, "Office2");
        const office3 = new Office(newCompany, "Office3");
        const office4 = new Office(newCompany, "Office4");
        const office5 = new Office(newCompany, "Office5");
        
        await j.fact(office1);
        await j.fact(office2);
        await j.fact(office3);
        await j.fact(office4);
        await j.fact(office5);
        
        // Wait for all notifications to process
        await officeObserver.processed();
        
        officeObserver.stop();

        // Verify all offices are notified
        expect(offices).toContain(j.hash(office1));
        expect(offices).toContain(j.hash(office2));
        expect(offices).toContain(j.hash(office3));
        expect(offices).toContain(j.hash(office4));
        expect(offices).toContain(j.hash(office5));
        expect(offices.length).toBe(5);
    });

    it("should handle facts added during watch initialization", async () => {
        const newCompany = new Company(creator, "InitCo");
        await j.fact(newCompany);

        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const offices: string[] = [];
        
        // Start watch and immediately add facts before loaded() resolves
        const officeObserver = j.watch(specification, newCompany, office => {
            offices.push(j.hash(office));
        });

        // Add facts while watch is initializing
        const office1 = new Office(newCompany, "Office1");
        const office2 = new Office(newCompany, "Office2");
        const office3 = new Office(newCompany, "Office3");
        
        const addPromise1 = j.fact(office1);
        const addPromise2 = j.fact(office2);
        const addPromise3 = j.fact(office3);
        
        // Wait for watch to load and all facts to be added
        await Promise.all([
            officeObserver.loaded(),
            addPromise1,
            addPromise2,
            addPromise3
        ]);
        
        // Wait for all notifications to process
        await officeObserver.processed();
        
        officeObserver.stop();

        // Verify all facts are eventually notified (no duplicates)
        expect(offices).toContain(j.hash(office1));
        expect(offices).toContain(j.hash(office2));
        expect(offices).toContain(j.hash(office3));
        expect(offices.length).toBe(3);
        
        // Verify no duplicates
        const uniqueOffices = new Set(offices);
        expect(uniqueOffices.size).toBe(3);
    });

    it("should handle multiple managers with concurrent updates", async () => {
        const newOffice = new Office(company, "MultiManagerOffice");
        await j.fact(newOffice);

        // Watch for all managers with current names
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Manager)
                .join(manager => manager.office, office)
                .select(manager => ({
                    manager: manager,
                    names: facts.ofType(ManagerName)
                        .join(name => name.manager, manager)
                        .notExists(name => facts.ofType(ManagerName)
                            .join(next => next.manager, manager)
                            .join(next => next.prior, name)
                        )
                        .select(name => name.value)
                }))
        );

        const managers: {
            manager: Manager,
            names: string[]
        }[] = [];
        
        const managerObserver = j.watch(specification, newOffice, manager => {
            const model = {
                manager: manager.manager,
                names: [] as string[]
            };
            managers.push(model);
            
            manager.names.onAdded(name => {
                model.names.push(name);
                return () => {
                    const index = model.names.indexOf(name);
                    if (index > -1) {
                        model.names.splice(index, 1);
                    }
                };
            });
        });

        await managerObserver.loaded();
        
        // Initially should be empty
        expect(managers).toEqual([]);

        // Add manager1 with name1
        const manager1 = new Manager(newOffice, 6001);
        await j.fact(manager1);
        await managerObserver.processed();
        
        const name1 = new ManagerName(manager1, "Alice", []);
        await j.fact(name1);
        await managerObserver.processed();
        
        // Add manager2 with name2
        const manager2 = new Manager(newOffice, 6002);
        await j.fact(manager2);
        await managerObserver.processed();
        
        const name2 = new ManagerName(manager2, "Bob", []);
        await j.fact(name2);
        await managerObserver.processed();
        
        // Update manager1's name: add name3 and name4 simultaneously with same prior: [name1]
        const name3 = new ManagerName(manager1, "Charlie", [name1]);
        const name4 = new ManagerName(manager1, "David", [name1]);
        await j.fact(name3);
        await j.fact(name4);
        await managerObserver.processed();
        
        managerObserver.stop();

        // Verify watch shows manager1 with both name3 and name4, manager2 with name2
        expect(managers).toHaveLength(2);
        
        const manager1Data = managers.find(m => m.manager.employeeNumber === 6001);
        const manager2Data = managers.find(m => m.manager.employeeNumber === 6002);
        
        expect(manager1Data).toBeDefined();
        expect(manager2Data).toBeDefined();
        
        // manager1 should have Charlie and David (Alice removed when they replaced it)
        expect(manager1Data!.names).toContain("Charlie");
        expect(manager1Data!.names).toContain("David");
        expect(manager1Data!.names).not.toContain("Alice");
        expect(manager1Data!.names.length).toBe(2);
        
        // manager2 should still have Bob (no updates to it)
        expect(manager2Data!.names).toEqual(["Bob"]);
    });
});

