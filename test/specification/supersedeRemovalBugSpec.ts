import { Jinaga, JinagaTest, User } from "@src";
import { Company, Manager, ManagerName, Office, model } from "../companyModel";

describe("nested collection supersede removal", () => {
    let creator: User;
    let company: Company;
    let office: Office;
    let manager: Manager;
    let j: Jinaga;

    beforeEach(() => {
        creator = new User("--- KEY ---");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        manager = new Manager(office, 501);
    });

    // Nested grandchild collection using the current-value (supersession) idiom:
    // names = ManagerName successors of manager that have NO successor naming them as `prior`.
    const specification = model.given(Company).match((company, facts) =>
        facts.ofType(Office)
            .join(office => office.company, company)
            .select(office => ({
                managers: facts.ofType(Manager)
                    .join(m => m.office, office)
                    .select(m => ({
                        employeeNumber: m.employeeNumber,
                        names: facts.ofType(ManagerName)
                            .join(mn => mn.manager, m)
                            .notExists(mn =>
                                facts.ofType(ManagerName)
                                    .join(next => next.prior, mn))
                            .select(mn => mn.value)
                    }))
            }))
    );

    it("removes the superseded name from the nested collection", async () => {
        const original = new ManagerName(manager, "John Doe", []);
        j = JinagaTest.create({
            initialState: [creator, company, office, manager, original]
        });

        // Track the live nested `names` collection with add/remove callbacks.
        let names: string[] = [];
        const observer = j.watch(specification, company, officeProj => {
            officeProj.managers.onAdded(managerProj => {
                managerProj.names.onAdded(name => {
                    names.push(name);
                    return () => {
                        names = names.filter(n => n !== name);
                    };
                });
            });
        });

        await observer.loaded();
        expect(names).toEqual(["John Doe"]);

        // Supersede: new ManagerName whose `prior` is the original.
        await j.fact(new ManagerName(manager, "Jane Smith", [original]));

        // Expected: original removed, replacement added -> ["Jane Smith"].
        expect(names).toEqual(["Jane Smith"]);

        observer.stop();
    });
});
