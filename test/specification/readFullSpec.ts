import { dehydrateReference, Dehydration, FactEnvelope, MemoryStore, SpecificationParser, User } from "@src";
import { Company, Office, OfficeClosed } from "../companyModel";

/**
 * Issue #232 at the storage layer. `read` collapses three situations into the
 * empty array; `readFull` keeps them apart. The boundary that matters most is
 * between a given that is absent and a given that exists but is excluded by a
 * given condition — the second is a complete answer of zero rows.
 */
describe("readFull", () => {
    let store: MemoryStore;
    let company: Company;
    let emptyCompany: Company;
    let closedCompany: Company;
    let absentCompany: Company;

    beforeEach(async () => {
        store = new MemoryStore();

        const creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        emptyCompany = new Company(creator, "EmptyCo");
        closedCompany = new Company(creator, "ClosedCo");
        absentCompany = new Company(creator, "AbsentCo");
        const office = new Office(company, "TestOffice");
        const closedOffice = new Office(closedCompany, "ClosedOffice");
        const closed = new OfficeClosed(closedOffice, new Date());

        const dehydration = new Dehydration();
        dehydration.dehydrate(creator);
        dehydration.dehydrate(company);
        dehydration.dehydrate(emptyCompany);
        dehydration.dehydrate(closedCompany);
        dehydration.dehydrate(office);
        dehydration.dehydrate(closedOffice);
        dehydration.dehydrate(closed);
        // absentCompany is deliberately never dehydrated.

        const envelopes: FactEnvelope[] = dehydration.factRecords()
            .map(fact => ({ fact, signatures: [] }));
        await store.save(envelopes);
    });

    const officesSpec = `
        (company: Company) {
            office: Office [
                office->company: Company = company
            ]
        } => office
    `;

    it("reports complete with results when the given exists and matches", async () => {
        const result = await readFull(officesSpec, [company]);

        expect(result.kind).toBe("complete");
        if (result.kind === "complete") {
            expect(result.results).toHaveLength(1);
        }
    });

    it("reports complete with zero results when the given exists but matches nothing", async () => {
        const result = await readFull(officesSpec, [emptyCompany]);

        expect(result.kind).toBe("complete");
        if (result.kind === "complete") {
            expect(result.results).toEqual([]);
        }
    });

    it("reports given-not-found when the given is absent", async () => {
        const result = await readFull(officesSpec, [absentCompany]);

        expect(result.kind).toBe("given-not-found");
        if (result.kind === "given-not-found") {
            expect(result.references).toEqual([dehydrateReference(absentCompany)]);
        }
    });

    it("reports complete when a given condition excludes an existing given", async () => {
        // The given is present; the specification's own condition rules it out.
        // That is an answer, not a failed read, so it must not be reported as
        // a missing given.
        const excludedSpec = `
            (company: Company [
                !E {
                    office: Office [
                        office->company: Company = company
                    ]
                }
            ]) {
                office: Office [
                    office->company: Company = company
                ]
            } => office
        `;

        const result = await readFull(excludedSpec, [company]);

        expect(result.kind).toBe("complete");
        if (result.kind === "complete") {
            expect(result.results).toEqual([]);
        }
    });

    it("keeps read() returning an empty array in every case", async () => {
        // The derived projection is unchanged, which is what leaves the
        // internal callers (authorization, distribution, purge) untouched.
        expect(await read(officesSpec, [absentCompany])).toEqual([]);
        expect(await read(officesSpec, [emptyCompany])).toEqual([]);
        expect(await read(officesSpec, [company])).toHaveLength(1);
    });

    function parse(specText: string) {
        const parser = new SpecificationParser(specText);
        parser.skipWhitespace();
        return parser.parseSpecification();
    }

    function readFull(specText: string, given: any[]) {
        return store.readFull(given.map(o => dehydrateReference(o)), parse(specText));
    }

    function read(specText: string, given: any[]) {
        return store.read(given.map(o => dehydrateReference(o)), parse(specText));
    }
});
