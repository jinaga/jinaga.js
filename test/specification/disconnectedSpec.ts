import { DisconnectedSpecificationError, DistributionRules, Invalid, Specification, SpecificationParser, buildModel, detectDisconnectedSpecification, invertSpecification } from "@src";

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

class Visit {
    static Type = "GameHub.Visit";
    type = "GameHub.Visit";
    playground!: Playground;
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

    it("allows a given that only a projection names", () => {
        // p2 is named by the projection and by no match. Projecting a given
        // copies the one fact it binds into every row, so it joins nothing and
        // multiplies nothing: it is not a component of its own, and this
        // specification is connected (jinaga/jinaga-spec#60).
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
        expect(() => detectDisconnectedSpecification(spec)).not.toThrow();
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
            // Each given carries a match of its own and nothing joins the two,
            // so the specification is a product of two sets of rows.
            const spec = parseSpecification(`
                (p1: GameHub.Player, p2: GameHub.Playground) {
                    u1: GameHub.Join [
                        u1->player:GameHub.Player = p1
                    ]
                    u2: GameHub.Visit [
                        u2->playground:GameHub.Playground = p2
                    ]
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
        // An existential condition joins its own matches to the match it sits
        // on, and no further: it does not reach u2's cluster, so the two
        // clusters stay disconnected.
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
                    u2: GameHub.Visit [
                        u2->playground:GameHub.Playground = p2
                    ]
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
            .type(Visit, f => f.predecessor("playground", Playground))
        );

        expect(() => {
            // A child inherits its parent's matches, so `visits` placed under
            // the join is read for each join, and nothing joins a playground's
            // visits to a player's joins: that child is the product of the two
            // chains. Two children of a root with no matches is the rewrite,
            // and is accepted.
            const spec = model.given(Player, Playground).match((player, playground, r) =>
                r.ofType(Join).join(j => j.player, player)
                    .select(join => ({
                        visits: playground.successors(Visit, visit => visit.playground)
                    }))
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

    it("allows a given whose only use is inside its own condition", () => {
        // p1 is named by no match of the specification, only by the match
        // inside its own condition. `usedGivens` reads the specification's
        // matches, as the proved check does, and a condition on a given is not
        // one: it filters the single row its given contributes and joins
        // nothing. So p1 is an unused given, which is allowed
        // (jinaga/jinaga-spec#60).
        //
        // Counting such a given instead, while a condition on a given
        // contributes no edge, refuses the shape `givenConditionsSpec` and
        // `src/conformance/storage-conformance.ts` both read, where one
        // given's condition references a prior given.
        //
        // `invertSpecification` cannot invert an unused given: it promotes a
        // given's conditions to a match's and reaches `shakeTree`, which
        // refuses it as a plain error rather than as a client error. That is
        // true of every unused given, not of this shape in particular, and
        // jinaga-spec's inverse vectors record it on `unused-given` and
        // `no-matches-two-givens` as a change today's `invertSpecification`
        // misses.
        expect(() => parseSpecification(`
            (p1: Root [
                !E {
                    op: Opened [
                        op->root: Root = p1
                    ]
                }
            ], p2: Channel) {
                t: Task [
                    t->channel: Channel = p2
                ]
            }`)).not.toThrow();
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

describe("A given that no match uses", () => {
    // The maintainer's decision of 2026-11-23 (jinaga/jinaga-spec#60): a given
    // that no match uses is allowed. A given binds one fact rather than a set
    // of rows, so it is a parameter of the query and never a factor of a
    // product. jinaga-spec's `asFeed` takes only the givens the matches use as
    // a feed's givens, and its `isConnected` counts only those.
    //
    // Each case is checked twice over: that the parser accepts the text, and
    // that the check itself accepts the specification. A parse-time refusal and
    // a refusal from the check are two different regressions, and either one
    // keeps a replica from loading rules it must load.

    it("allows a lone given no match uses", () => {
        const spec = parseSpecification(`(p1: R) { } => p1`);
        expect(() => detectDisconnectedSpecification(spec)).not.toThrow();
    });

    it("allows a second given no match uses, where there are no matches", () => {
        // The shape of the `with` principal of a multi-given distribution
        // share rule.
        const spec = parseSpecification(`(p1: R, p2: A) { } => p2`);
        expect(() => detectDisconnectedSpecification(spec)).not.toThrow();
    });

    it("allows a given no match uses beside a match that uses another", () => {
        const spec = parseSpecification(`(p1: R, p2: A) { u: A [ u->r: R = p1 ] } => u`);
        expect(() => detectDisconnectedSpecification(spec)).not.toThrow();
    });

    it("loads a multi-given share rule whose principal uses one of its givens", () => {
        // `describeDistributionRules` to `loadFromDescription` is how a
        // replicator receives its rules, so a `with` principal that this check
        // refuses makes a shipped and legal rule unloadable. A multi-given
        // share rule has no other principal available: projecting one of its
        // givens is the shape, and joining through a fact would change the
        // rule's meaning.
        expect(() => DistributionRules.loadFromDescription(`
            distribution {
                share (blog: Blog, author: Jinaga.User) {
                    post: Post [
                        post->blog: Blog = blog
                    ]
                    comment: Comment [
                        comment->post: Post = post
                        comment->author: Jinaga.User = author
                    ]
                } => comment
                with (blog: Blog, author: Jinaga.User) {
                } => author
            }`)).not.toThrow();
    });
});
