import { Jinaga, JinagaTest, User } from "@src";
import { Company, Office, model } from "../companyModel";

describe("Predecessor Pattern Observer", () => {
    let j: Jinaga;
    let creator: User;
    let company: Company;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        
        // Start with company but NO office yet
        j = JinagaTest.create({
            initialState: [creator, company]
        });
    });

    it("should invoke callback exactly once when given fact arrives", async () => {
        // Specification that navigates from Office (given) to Company (predecessor)
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Company)
                .join(company => company, office.company)
        );

        // Track callback invocations
        const callbacks: Company[] = [];
        
        // Subscribe before the Office exists
        const observer = j.watch(specification, new Office(company, "TestOffice"), companyResult => {
            callbacks.push(companyResult);
        });

        await observer.loaded();
        
        // At this point, Office doesn't exist, so no callbacks yet
        expect(callbacks.length).toBe(0);

        // Now save the Office fact - this triggers the observer
        const office = await j.fact(new Office(company, "TestOffice"));
        await observer.processed();

        // Callback should be invoked EXACTLY ONCE, not twice
        expect(callbacks.length).toBe(1);
        expect(callbacks[0]).toMatchObject({
            type: "Company",
            identifier: "TestCo"
        });

        observer.stop();
    });

    it("should invoke callback exactly once when given fact exists before subscription", async () => {
        // Create office before subscribing
        const office = await j.fact(new Office(company, "TestOffice"));

        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Company)
                .join(company => company, office.company)
        );

        const callbacks: Company[] = [];
        
        const observer = j.watch(specification, office, companyResult => {
            callbacks.push(companyResult);
        });

        await observer.loaded();

        // Callback should be invoked EXACTLY ONCE during initial load
        expect(callbacks.length).toBe(1);
        expect(callbacks[0]).toMatchObject({
            type: "Company",
            identifier: "TestCo"
        });

        observer.stop();
    });
});

