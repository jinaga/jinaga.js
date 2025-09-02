import { SpecificationRunner, FactSource } from "../../src/specification/specification-runner";
import { FactRecord, FactReference } from "../../src/storage";
import { Specification, SpecificationGiven } from "../../src/specification/specification";

// Mock FactSource for testing
class MockFactSource implements FactSource {
    private facts: Map<string, FactRecord> = new Map();
    private predecessors: Map<string, Map<string, FactReference[]>> = new Map();
    private successors: Map<string, Map<string, FactReference[]>> = new Map();

    addFact(fact: FactRecord): void {
        const key = `${fact.type}:${fact.hash}`;
        this.facts.set(key, fact);
    }

    addRelation(from: FactReference, roleName: string, to: FactReference): void {
        // Add predecessor relationship (from -> to)
        const fromKey = `${from.type}:${from.hash}`;
        if (!this.predecessors.has(fromKey)) {
            this.predecessors.set(fromKey, new Map());
        }
        const roleMap = this.predecessors.get(fromKey)!;
        if (!roleMap.has(roleName)) {
            roleMap.set(roleName, []);
        }
        roleMap.get(roleName)!.push(to);

        // Add successor relationship (to <- from)
        const toKey = `${to.type}:${to.hash}`;
        if (!this.successors.has(toKey)) {
            this.successors.set(toKey, new Map());
        }
        const toRoleMap = this.successors.get(toKey)!;
        if (!toRoleMap.has(roleName)) {
            toRoleMap.set(roleName, []);
        }
        toRoleMap.get(roleName)!.push(from);
    }

    async findFact(reference: FactReference): Promise<FactRecord | null> {
        const key = `${reference.type}:${reference.hash}`;
        return this.facts.get(key) || null;
    }

    async getPredecessors(reference: FactReference, name: string, predecessorType: string): Promise<FactReference[]> {
        const key = `${reference.type}:${reference.hash}`;
        const roleMap = this.predecessors.get(key);
        if (!roleMap) return [];
        const refs = roleMap.get(name) || [];
        return refs.filter(ref => ref.type === predecessorType);
    }

    async getSuccessors(reference: FactReference, name: string, successorType: string): Promise<FactReference[]> {
        const key = `${reference.type}:${reference.hash}`;
        const roleMap = this.successors.get(key);
        if (!roleMap) return [];
        const refs = roleMap.get(name) || [];
        return refs.filter(ref => ref.type === successorType);
    }

    async hydrate(reference: FactReference): Promise<unknown> {
        const fact = await this.findFact(reference);
        return fact ? { ...fact.fields, type: fact.type, hash: fact.hash } : null;
    }
}

describe("SpecificationRunner Given Conditions", () => {
    let runner: SpecificationRunner;
    let source: MockFactSource;

    beforeEach(() => {
        source = new MockFactSource();
        runner = new SpecificationRunner(source);

        // Set up test data: Office and OfficeClosed facts
        const office1: FactRecord = {
            type: "Office",
            hash: "office1",
            fields: { identifier: "Office1" }
        };
        const office2: FactRecord = {
            type: "Office", 
            hash: "office2",
            fields: { identifier: "Office2" }
        };
        const closure: FactRecord = {
            type: "Office.Closed",
            hash: "closure1", 
            fields: { date: "2023-01-01" }
        };

        source.addFact(office1);
        source.addFact(office2);
        source.addFact(closure);
        
        // office2 is closed (has closure pointing to it)
        source.addRelation(
            { type: "Office.Closed", hash: "closure1" },
            "office",
            { type: "Office", hash: "office2" }
        );
    });

    it("should pass given without conditions (backward compatibility)", async () => {
        const specification: Specification = {
            given: [{
                label: { name: "office", type: "Office" },
                conditions: [] // No conditions
            }],
            matches: [],
            projection: { type: "fact", label: "office" }
        };

        // Both offices should pass (no conditions to filter them)
        const result1 = await runner.read([{ type: "Office", hash: "office1" }], specification);
        expect(result1.length).toBe(1);

        const result2 = await runner.read([{ type: "Office", hash: "office2" }], specification);
        expect(result2.length).toBe(1);
    });

    it("should filter given with negative existential condition", async () => {
        const specification: Specification = {
            given: [{
                label: { name: "office", type: "Office" },
                conditions: [{
                    type: "existential",
                    exists: false, // Must NOT exist
                    matches: [{
                        unknown: { name: "closure", type: "Office.Closed" },
                        conditions: [{
                            type: "path",
                            rolesLeft: [{ name: "office", predecessorType: "Office" }],
                            labelRight: "office",
                            rolesRight: []
                        }]
                    }]
                }]
            }],
            matches: [],
            projection: { type: "fact", label: "office" }
        };

        // office1 (not closed) should pass
        const result1 = await runner.read([{ type: "Office", hash: "office1" }], specification);
        expect(result1.length).toBe(1);

        // office2 (closed) should be filtered out
        const result2 = await runner.read([{ type: "Office", hash: "office2" }], specification);
        expect(result2.length).toBe(0);
    });

    it("should filter given with positive existential condition", async () => {
        const specification: Specification = {
            given: [{
                label: { name: "office", type: "Office" },
                conditions: [{
                    type: "existential",
                    exists: true, // Must exist
                    matches: [{
                        unknown: { name: "closure", type: "Office.Closed" },
                        conditions: [{
                            type: "path",
                            rolesLeft: [{ name: "office", predecessorType: "Office" }],
                            labelRight: "office",
                            rolesRight: []
                        }]
                    }]
                }]
            }],
            matches: [],
            projection: { type: "fact", label: "office" }
        };

        // office1 (not closed) should be filtered out
        const result1 = await runner.read([{ type: "Office", hash: "office1" }], specification);
        expect(result1.length).toBe(0);

        // office2 (closed) should pass
        const result2 = await runner.read([{ type: "Office", hash: "office2" }], specification);
        expect(result2.length).toBe(1);
    });

    it("should handle multiple givens where one fails condition", async () => {
        const company: FactRecord = {
            type: "Company",
            hash: "company1",
            fields: { name: "TestCo" }
        };
        source.addFact(company);

        const specification: Specification = {
            given: [
                {
                    label: { name: "company", type: "Company" },
                    conditions: [] // No conditions
                },
                {
                    label: { name: "office", type: "Office" },
                    conditions: [{
                        type: "existential",
                        exists: false, // Must NOT be closed
                        matches: [{
                            unknown: { name: "closure", type: "Office.Closed" },
                            conditions: [{
                                type: "path",
                                rolesLeft: [{ name: "office", predecessorType: "Office" }],
                                labelRight: "office",
                                rolesRight: []
                            }]
                        }]
                    }]
                }
            ],
            matches: [],
            projection: { 
                type: "composite", 
                components: [
                    { type: "fact", name: "company", label: "company" },
                    { type: "fact", name: "office", label: "office" }
                ]
            }
        };

        // company + office1 (not closed) should pass
        const result1 = await runner.read([
            { type: "Company", hash: "company1" },
            { type: "Office", hash: "office1" }
        ], specification);
        expect(result1.length).toBe(1);

        // company + office2 (closed) should be filtered out entirely
        const result2 = await runner.read([
            { type: "Company", hash: "company1" },
            { type: "Office", hash: "office2" }
        ], specification);
        expect(result2.length).toBe(0);
    });
});