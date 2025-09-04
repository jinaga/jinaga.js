import { invertSpecification, Specification } from "@src";

// Test case to reproduce the infinite loop issue
describe("specification inverse infinite loop bug", () => {
    it("should not cause infinite loop with complex match structures", () => {
        // Create a specification that previously caused infinite loop
        const specification: Specification = {
            given: [{ label: { name: "p1", type: "User" }, conditions: [] }],
            matches: [
                {
                    unknown: { name: "u1", type: "GameChallenge" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "gameHub", predecessorType: "GameHub" }],
                            labelRight: "u2",
                            rolesRight: []
                        }
                    ]
                },
                {
                    unknown: { name: "u2", type: "GameHub" },
                    conditions: []
                },
                {
                    unknown: { name: "u3", type: "Player" },
                    conditions: []
                },
                {
                    unknown: { name: "u4", type: "GameSession" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "gameHub", predecessorType: "GameHub" }],
                            labelRight: "u2",
                            rolesRight: []
                        }
                    ]
                },
                {
                    unknown: { name: "u5", type: "PlayerMove" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "player", predecessorType: "Player" }],
                            labelRight: "u3",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: { type: "composite", components: [] }
        };

        // This should throw an error (specific labels may vary due to processing order)
        expect(() => invertSpecification(specification))
            .toThrow("Disconnected specification detected");
    });
});