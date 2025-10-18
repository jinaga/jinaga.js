import { Jinaga, JinagaTest, User } from "@src";
import { Company, Office, Manager, model } from "../companyModel";

describe("race condition in observer", () => {
    let j: Jinaga;
    let creator: User;
    let company: Company;
    let office: Office;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        j = JinagaTest.create({
            initialState: [creator, company, office]
        });
    });

    it("should capture facts added during observer initialization", async () => {
        // This test validates that facts arriving during the observer's read() operation
        // are captured by establishing listeners before reading data
        
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Manager)
                .join(manager => manager.office, office)
                .select(manager => manager.employeeNumber)
        );

        const managers: number[] = [];
        
        // Start the observer
        const observer = j.watch(specification, office, employeeNumber => {
            managers.push(employeeNumber);
        });

        // Don't wait for loaded() - immediately add a fact
        // This simulates a fact arriving during the read operation
        const manager1 = new Manager(office, 1);
        await j.fact(manager1);
        
        // Wait for the observer to load
        await observer.loaded();
        
        // The manager added during initialization should be captured
        expect(managers).toContain(1);
        
        // Add another manager after loading completes
        const manager2 = new Manager(office, 2);
        await j.fact(manager2);
        
        observer.stop();
        
        // Both managers should be captured
        expect(managers).toEqual(expect.arrayContaining([1, 2]));
        expect(managers).toHaveLength(2);
    });

    it("should not miss facts when multiple observers start simultaneously", async () => {
        // This test validates that multiple observers starting simultaneously
        // don't miss facts due to race conditions
        
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Manager)
                .join(manager => manager.office, office)
                .select(manager => manager.employeeNumber)
        );

        const managers1: number[] = [];
        const managers2: number[] = [];
        
        // Start two observers simultaneously
        const observer1 = j.watch(specification, office, employeeNumber => {
            managers1.push(employeeNumber);
        });
        
        const observer2 = j.watch(specification, office, employeeNumber => {
            managers2.push(employeeNumber);
        });

        // Add a fact before either observer completes loading
        const manager1 = new Manager(office, 10);
        await j.fact(manager1);
        
        // Wait for both observers to load
        await Promise.all([observer1.loaded(), observer2.loaded()]);
        
        // Both observers should capture the manager
        expect(managers1).toContain(10);
        expect(managers2).toContain(10);
        
        // Add another manager after loading
        const manager2 = new Manager(office, 20);
        await j.fact(manager2);
        
        observer1.stop();
        observer2.stop();
        
        // Both observers should have captured both managers
        expect(managers1).toEqual(expect.arrayContaining([10, 20]));
        expect(managers2).toEqual(expect.arrayContaining([10, 20]));
        expect(managers1).toHaveLength(2);
        expect(managers2).toHaveLength(2);
    });

    it("should handle rapid fact additions during initialization", async () => {
        // This test validates that rapid fact additions during initialization
        // are all captured without gaps
        
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Manager)
                .join(manager => manager.office, office)
                .select(manager => manager.employeeNumber)
        );

        const managers: number[] = [];
        
        // Start the observer
        const observer = j.watch(specification, office, employeeNumber => {
            managers.push(employeeNumber);
        });

        // Rapidly add multiple facts without waiting
        const addFacts = async () => {
            for (let i = 1; i <= 5; i++) {
                const manager = new Manager(office, i * 100);
                await j.fact(manager);
            }
        };
        
        // Start adding facts immediately
        const addFactsPromise = addFacts();
        
        // Wait for both the observer and fact additions to complete
        await Promise.all([observer.loaded(), addFactsPromise]);
        
        observer.stop();
        
        // All managers should be captured
        expect(managers).toEqual(expect.arrayContaining([100, 200, 300, 400, 500]));
        expect(managers).toHaveLength(5);
    });

    it("should properly handle observer stopped during initialization", async () => {
        // This test validates that stopping an observer during initialization
        // doesn't cause issues even with the listeners established early
        
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Manager)
                .join(manager => manager.office, office)
                .select(manager => manager.employeeNumber)
        );

        const managers: number[] = [];
        
        // Start the observer
        const observer = j.watch(specification, office, employeeNumber => {
            managers.push(employeeNumber);
        });

        // Immediately stop the observer before it completes loading
        observer.stop();
        
        // Add a fact after stopping
        const manager = new Manager(office, 99);
        await j.fact(manager);
        
        // Wait for loaded to complete (should handle being stopped gracefully)
        await observer.loaded();
        
        // No managers should be captured since we stopped before loading
        expect(managers).toHaveLength(0);
    });
});
