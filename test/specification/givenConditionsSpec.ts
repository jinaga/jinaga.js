import { SpecificationParser } from "../../src/specification/specification-parser";
import { describeSpecification } from "../../src/specification/description";
import { Specification } from "../../src/specification/specification";

describe("Given Conditions", () => {
    function parseSpecification(input: string): Specification {
        const parser = new SpecificationParser(input);
        parser.skipWhitespace();
        return parser.parseSpecification();
    }

    it("should parse simple given without conditions", () => {
        const specification = parseSpecification(`
            (office: Office) {
                company: Company [
                    company = office->company: Company
                ]
            } => office
        `);

        expect(specification.given.length).toBe(1);
        expect(specification.given[0].label.name).toBe("office");
        expect(specification.given[0].label.type).toBe("Office");
        expect(specification.given[0].conditions.length).toBe(0);
    });

    it("should parse given with negative existential condition", () => {
        const specification = parseSpecification(`
            (office: Office [
                !E {
                    closure: Office.Closed [
                        closure->office: Office = office
                    ]
                }
            ]) {
            } => office
        `);

        expect(specification.given.length).toBe(1);
        const given = specification.given[0];
        expect(given.label.name).toBe("office");
        expect(given.label.type).toBe("Office");
        expect(given.conditions.length).toBe(1);
        
        const condition = given.conditions[0];
        expect(condition.type).toBe("existential");
        expect(condition.exists).toBe(false);
        expect(condition.matches.length).toBe(1);
        
        const match = condition.matches[0];
        expect(match.unknown.name).toBe("closure");
        expect(match.unknown.type).toBe("Office.Closed");
        expect(match.conditions.length).toBe(1);
        
        const pathCondition = match.conditions[0];
        expect(pathCondition.type).toBe("path");
        if (pathCondition.type === "path") {
            expect(pathCondition.labelRight).toBe("office");
            expect(pathCondition.rolesLeft.length).toBe(1);
            expect(pathCondition.rolesLeft[0].name).toBe("office");
            expect(pathCondition.rolesLeft[0].predecessorType).toBe("Office");
            expect(pathCondition.rolesRight.length).toBe(0);
        }
    });

    it("should parse given with positive existential condition", () => {
        const specification = parseSpecification(`
            (office: Office [
                E {
                    closure: Office.Closed [
                        closure->office: Office = office
                    ]
                }
            ]) {
            } => office
        `);

        expect(specification.given.length).toBe(1);
        const given = specification.given[0];
        expect(given.label.name).toBe("office");
        expect(given.label.type).toBe("Office");
        expect(given.conditions.length).toBe(1);
        
        const condition = given.conditions[0];
        expect(condition.type).toBe("existential");
        expect(condition.exists).toBe(true);
    });

    it("should describe given with existential condition correctly", () => {
        const specification: Specification = {
            given: [{
                label: {
                    name: "office",
                    type: "Office"
                },
                conditions: [{
                    type: "existential",
                    exists: false,
                    matches: [{
                        unknown: {
                            name: "closure",
                            type: "Office.Closed"
                        },
                        conditions: [{
                            type: "path",
                            rolesLeft: [{
                                name: "office",
                                predecessorType: "Office"
                            }],
                            labelRight: "office",
                            rolesRight: []
                        }]
                    }]
                }]
            }],
            matches: [],
            projection: {
                type: "fact",
                label: "office"
            }
        };

        const description = describeSpecification(specification, 0);
        expect(description).toContain("office: Office [");
        expect(description).toContain("!E {");
        expect(description).toContain("closure: Office.Closed [");
        expect(description).toContain("closure->office: Office = office");
    });

    it("should parse multiple givens with different conditions", () => {
        const specification = parseSpecification(`
            (office: Office [
                !E {
                    closure: Office.Closed [
                        closure->office: Office = office
                    ]
                }
            ], user: User) {
            } => office
        `);

        expect(specification.given.length).toBe(2);
        
        const firstGiven = specification.given[0];
        expect(firstGiven.label.name).toBe("office");
        expect(firstGiven.conditions.length).toBe(1);
        
        const secondGiven = specification.given[1];
        expect(secondGiven.label.name).toBe("user");
        expect(secondGiven.label.type).toBe("User");
        expect(secondGiven.conditions.length).toBe(0);
    });
});