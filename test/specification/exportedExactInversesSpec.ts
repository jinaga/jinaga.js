import { exactInverses, ExactInverses, invertSpecification, pinLabel, Specification, SpecificationParser } from "@src";

// Issue #459. A package outside this library asks which fact types can remove
// a row of a specification. It reads that from `exactInverses`, the inverter
// the row stream uses, through the package entry point. The legacy
// `invertSpecification` refuses some well-formed specifications, so it cannot
// answer for them.

function parse(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

function pinnedTypes(inverses: Specification[]): string[] {
    const types = inverses.map(inverse => {
        const pinned = inverse.given.find(g => g.label.name === pinLabel);
        if (!pinned) {
            throw new Error("An exact inverse has no pinned given.");
        }
        return pinned.label.type;
    });
    return [...new Set(types)].sort();
}

describe("exactInverses from the package entry point", () => {
    it("reads removes where invertSpecification refuses a given joined only inside a negation", () => {
        // `reviewer` is joined to the rest only by the `notExists` condition.
        const specification = parse(`
            (application: Application, reviewer: Reviewer) {
                decision: Decision [
                    decision->application: Application = application
                    !E {
                        veto: Veto [
                            veto->decision: Decision = decision
                            veto->reviewer: Reviewer = reviewer
                        ]
                    }
                ]
            } => decision`);

        expect(() => invertSpecification(specification)).toThrow(/not connected to the rest of the graph/);

        const inverses: ExactInverses = exactInverses(specification);
        expect(pinnedTypes(inverses.removes)).toEqual(["Veto"]);
    });

    it("reads the two sibling negations as the types that remove an application", () => {
        const specification = parse(`
            (user: Jinaga.User) {
                application: Application [
                    application->applicant: Jinaga.User = user
                    !E {
                        approved: ApplicationApproved [
                            approved->application: Application = application
                        ]
                    }
                    !E {
                        rejected: ApplicationRejected [
                            rejected->application: Application = application
                        ]
                    }
                ]
            } => application`);

        expect(pinnedTypes(exactInverses(specification).removes))
            .toEqual(["ApplicationApproved", "ApplicationRejected"]);
    });
});
