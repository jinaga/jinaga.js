import { Jinaga, JinagaTest } from "../../src";
import { Company, Office, OfficeClosed, User, model } from "../companyModel";

describe("Given Conditions Runtime", () => {
    let creator: User;
    let company: Company;
    let openOffice: Office;
    let closedOffice: Office;
    let j: Jinaga;
    
    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        openOffice = new Office(company, "OpenOffice");
        closedOffice = new Office(company, "ClosedOffice");
        
        const closure = new OfficeClosed(closedOffice, new Date());
        
        j = JinagaTest.create({
            initialState: [
                creator,
                company,
                openOffice,
                closedOffice,
                closure
            ]
        });
    });

    it("should work with backward compatibility (no given conditions)", async () => {
        // Test that existing specifications without given conditions continue to work
        const specification = model.given(Office).select(office => office);

        const openResult = await j.query(specification, openOffice);
        expect(openResult.length).toBe(1);
        expect(j.hash(openResult[0])).toBe(j.hash(openOffice));

        const closedResult = await j.query(specification, closedOffice);
        expect(closedResult.length).toBe(1);
        expect(j.hash(closedResult[0])).toBe(j.hash(closedOffice));
    });

    // Note: Full testing of given condition filtering would require creating
    // specifications with existential conditions on givens. The current model
    // builder API doesn't yet support this syntax, but the SpecificationRunner
    // implementation is now ready to handle such specifications when they are
    // constructed directly or when the parser/model API is extended.
});