import { DisconnectedSpecificationError, DistributionRules, Invalid, Specification, SpecificationParser, buildModel, invertSpecification } from "@src";

function parseSpecification(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

// Test classes for Model API testing
class Player {
    static Type = "GameHub.Player";
    type = "GameHub.Player";
}

class Playground {
    static Type = "GameHub.Playground";
    type = "GameHub.Playground";
    code!: string;
}

class Join {
    static Type = "GameHub.Join";
    type = "GameHub.Join";
    player!: Player;
}

describe("Disconnected specification detection", () => {
    it("allows connected specifications", () => {
        // This should not throw - all labels are connected
        expect(() => parseSpecification(`
            (player: GameHub.Player) {
                join: GameHub.Join [
                    join->player:GameHub.Player = player
                ]
                challenge: GameHub.Challenge [
                    challenge->opponentJoin:GameHub.Join = join
                ]
            }`)).not.toThrow();
    });

    it("allows single given specifications", () => {
        // Single label cannot be disconnected
        expect(() => parseSpecification(`
            (player: GameHub.Player) { }`)).not.toThrow();
    });

    it("allows empty match specifications", () => {
        // Single given with no matches
        expect(() => parseSpecification(`
            (player: GameHub.Player) { }`)).not.toThrow();
    });

    it("detects disconnected specification with isolated given", () => {
        // p2 is isolated and only referenced in projection
        expect(() => {
            const spec = parseSpecification(`
                (p1: GameHub.Player, p2: GameHub.Playground) {
                    u1: GameHub.Join [
                        u1->player:GameHub.Player = p1
                    ]
                    u3: GameHub.Challenge [
                        u3->opponentJoin:GameHub.Join = u1
                    ]
                } => {
                    playgroundCode = p2.code
                }`);
            invertSpecification(spec);
        }).toThrow(DisconnectedSpecificationError);
    });

    it("detects disconnected specification with multiple isolated clusters", () => {
        // Two separate match clusters: p1 connects to u1, p3 connects to u2, but no connection between clusters
        expect(() => {
            const spec = parseSpecification(`
                (p1: GameHub.Player, p3: GameHub.Game) {
                    u1: GameHub.Join [
                        u1->player:GameHub.Player = p1
                    ]
                    u2: GameHub.Level [
                        u2->game:GameHub.Game = p3
                    ]
                }`);
            invertSpecification(spec);
        }).toThrow(DisconnectedSpecificationError);
    });

    it("provides clear error message for disconnected specifications", () => {
        try {
            const spec = parseSpecification(`
                (p1: GameHub.Player, p2: GameHub.Playground) {
                    u1: GameHub.Join [
                        u1->player:GameHub.Player = p1
                    ]
                } => {
                    playgroundCode = p2.code
                }`);
            invertSpecification(spec);
            fail("Expected DisconnectedSpecificationError to be thrown");
        } catch (error: any) {
            expect(error).toBeInstanceOf(DisconnectedSpecificationError);
            expect(error.message).toContain("Disconnected specification detected");
            expect(error.message).toContain("2 disconnected subgraphs");
            expect(error.message).toContain("Subgraph 1");
            expect(error.message).toContain("Subgraph 2");
            // Expect the error message to include label types
            expect(error.message).toMatch(/'[^']+:GameHub\.(Player|Join|Playground)'/);
        }
    });

    it("allows specifications with projections that reference connected labels", () => {
        // p2 is connected through a match condition
        expect(() => parseSpecification(`
            (p1: GameHub.Player, p2: GameHub.Playground) {
                u1: GameHub.Join [
                    u1->player:GameHub.Player = p1
                    u1->playground:GameHub.Playground = p2
                ]
            } => {
                playgroundCode = p2.code
            }`)).not.toThrow();
    });

    it("detects disconnected specifications with existential conditions", () => {
        expect(() => {
            const spec = parseSpecification(`
                (p1: GameHub.Player, p2: GameHub.Playground) {
                    u1: GameHub.Join [
                        u1->player:GameHub.Player = p1
                        !E {
                            revoked: GameHub.Join.Revoked [
                                revoked->join:GameHub.Join = u1
                            ]
                        }
                    ]
                } => {
                    playgroundCode = p2.code
                }`);
            invertSpecification(spec);
        }).toThrow(DisconnectedSpecificationError);
    });

    it("allows connected specifications with existential conditions", () => {
        expect(() => parseSpecification(`
            (p1: GameHub.Player) {
                u1: GameHub.Join [
                    u1->player:GameHub.Player = p1
                    !E {
                        revoked: GameHub.Join.Revoked [
                            revoked->join:GameHub.Join = u1
                        ]
                    }
                ]
            }`)).not.toThrow();
    });

    it("allows specifications with nested projections", () => {
        expect(() => parseSpecification(`
            (player: GameHub.Player) {
                join: GameHub.Join [
                    join->player:GameHub.Player = player
                ]
            } => {
                challenges = {
                    challenge: GameHub.Challenge [
                        challenge->opponentJoin:GameHub.Join = join
                    ]
                }
            }`)).not.toThrow();
    });

    it("detects disconnected specifications with nested projections", () => {
        expect(() => {
            const spec = parseSpecification(`
                (p1: GameHub.Player, p2: GameHub.Playground) {
                    u1: GameHub.Join [
                        u1->player:GameHub.Player = p1
                    ]
                } => {
                    playgrounds = {
                        playground: GameHub.Playground [
                            playground->playground:GameHub.Playground = p2
                        ]
                    }
                }`);
            invertSpecification(spec);
        }).toThrow(DisconnectedSpecificationError);
    });

    it("handles specification projections correctly - should be connected if nested matches connect to main graph", () => {
        expect(() => parseSpecification(`
            (player: GameHub.Player) {
                join: GameHub.Join [
                    join->player:GameHub.Player = player
                ]
            } => {
                challenges = {
                    challenge: GameHub.Challenge [
                        challenge->opponentJoin:GameHub.Join = join
                    ]
                } => {
                    details = challenge.details
                }
            }`)).not.toThrow();
    });

    it("detects disconnected specification projections", () => {
        expect(() => {
            const spec = parseSpecification(`
                (p1: GameHub.Player, p2: GameHub.Playground) {
                    u1: GameHub.Join [
                        u1->player:GameHub.Player = p1
                    ]
                } => {
                    playgroundChallenges = {
                        challenge: GameHub.Challenge [
                            challenge->playground:GameHub.Playground = p2
                        ]
                    }
                }`);
            invertSpecification(spec);
        }).toThrow(DisconnectedSpecificationError);
    });

    it("detects disconnected specifications when using Model API with match()", () => {
        // Test that Model API also detects disconnected specifications
        const model = buildModel(b => b
            .type(Player)
            .type(Playground) 
            .type(Join, f => f.predecessor("player", Player))
        );

        expect(() => {
            // Create a disconnected specification: p1 connects to join, but p2 is isolated
            const spec = model.given(Player, Playground).match((player, playground, r) => 
                r.ofType(Join).join(j => j.player, player)
            );
            invertSpecification(spec.specification);
        }).toThrow(DisconnectedSpecificationError);
    });

    it("allows connected specifications when using Model API", () => {
        // Test that connected specifications work fine with Model API
        const model = buildModel(b => b
            .type(Player)
            .type(Join, f => f.predecessor("player", Player))
        );

        expect(() => {
            // This should work - only one given, connects properly
            model.given(Player).match((player, r) => 
                r.ofType(Join).join(j => j.player, player)
            );
        }).not.toThrow();
    });
});
describe("Disconnected specification detection at parse time", () => {
    const disconnectedProduct = `
        (o1: Office, o2: Office) {
            e1: Employee [
                e1->office: Office = o1
            ]
            e2: Employee [
                e2->office: Office = o2
            ]
        } => {
            a = e1
            b = e2
        }`;

    it("refuses a disconnected specification when it is parsed", () => {
        expect(() => parseSpecification(disconnectedProduct))
            .toThrow(DisconnectedSpecificationError);
    });

    it("names both subgraphs and their labels in the refusal", () => {
        let thrown: any = undefined;
        try {
            parseSpecification(disconnectedProduct);
        }
        catch (error: any) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(DisconnectedSpecificationError);

        // Both components, and every label in each, are named. The two
        // Employee labels carry the product that the store would otherwise
        // build, so a message that omits one does not say what was refused.
        const subgraphs = thrown.message.split("Subgraph ");
        expect(subgraphs).toHaveLength(3);
        expect(subgraphs[1]).toContain("'o1:Office'");
        expect(subgraphs[1]).toContain("'e1:Employee'");
        expect(subgraphs[2]).toContain("'o2:Office'");
        expect(subgraphs[2]).toContain("'e2:Employee'");
    });

    it("refuses it as a client error, not a crash", () => {
        expect(() => parseSpecification(disconnectedProduct))
            .toThrow(Invalid);
    });

    it("refuses a distribution rule whose share specification is disconnected", () => {
        // The rule set is refused where it is parsed, rather than later when a
        // feed is built from it.
        expect(() => DistributionRules.loadFromDescription(`
            distribution {
                share ${disconnectedProduct}
                with (user: Jinaga.User) {
                } => user
            }`)).toThrow(DisconnectedSpecificationError);
    });
});
