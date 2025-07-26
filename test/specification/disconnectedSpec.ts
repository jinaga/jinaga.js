import { DisconnectedSpecificationError, Specification, SpecificationParser } from "../../src";

function parseSpecification(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
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
        expect(() => parseSpecification(`
            (p1: GameHub.Player, p2: GameHub.Playground) {
                u1: GameHub.Join [
                    u1->player:GameHub.Player = p1
                ]
                u3: GameHub.Challenge [
                    u3->opponentJoin:GameHub.Join = u1
                ]
            } => {
                playgroundCode = p2.code
            }`)).toThrow(DisconnectedSpecificationError);
    });

    it("detects disconnected specification with multiple isolated clusters", () => {
        expect(() => parseSpecification(`
            (p1: GameHub.Player, p2: GameHub.Playground, p3: GameHub.Game) {
                u1: GameHub.Join [
                    u1->player:GameHub.Player = p1
                ]
                u2: GameHub.Level [
                    u2->game:GameHub.Game = p3
                ]
            }`)).toThrow(DisconnectedSpecificationError);
    });

    it("provides clear error message for disconnected specifications", () => {
        try {
            parseSpecification(`
                (p1: GameHub.Player, p2: GameHub.Playground) {
                    u1: GameHub.Join [
                        u1->player:GameHub.Player = p1
                    ]
                } => {
                    playgroundCode = p2.code
                }`);
            fail("Expected DisconnectedSpecificationError to be thrown");
        } catch (error: any) {
            expect(error).toBeInstanceOf(DisconnectedSpecificationError);
            expect(error.message).toContain("Disconnected specification detected");
            expect(error.message).toContain("2 disconnected subgraphs");
            expect(error.message).toContain("Subgraph 1");
            expect(error.message).toContain("Subgraph 2");
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
        expect(() => parseSpecification(`
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
            }`)).toThrow(DisconnectedSpecificationError);
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
        expect(() => parseSpecification(`
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
            }`)).toThrow(DisconnectedSpecificationError);
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
        expect(() => parseSpecification(`
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
            }`)).toThrow(DisconnectedSpecificationError);
    });
});