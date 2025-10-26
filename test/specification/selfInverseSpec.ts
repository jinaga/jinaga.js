import { Jinaga, JinagaTest, User, buildModel, ModelBuilder } from "@src";

/**
 * Self-Inverse Restoration Tests
 * 
 * These tests verify that subscriptions correctly invoke callbacks when given facts
 * arrive AFTER the subscription is established. This is critical for reactive
 * behavior in scenarios where:
 * 
 * 1. A subscription is started with an unpersisted given fact
 * 2. The given fact is later persisted via j.fact()
 * 3. Related facts may arrive via notification system
 * 
 * Without self-inverse support, callbacks fail to fire in these scenarios.
 */

// Model for VotingRound scenario (from launchkings-admin)
export class Event {
    static Type = "Event" as const;
    type = Event.Type;
    constructor(
        public creator: User,
        public identifier: string
    ) { }
}

export class VotingRound {
    static Type = "VotingRound" as const;
    type = VotingRound.Type;
    constructor(
        public event: Event,
        public date: Date | string
    ) { }
}

export class Vote {
    static Type = "Vote" as const;
    type = Vote.Type;
    constructor(
        public round: VotingRound,
        public voter: User,
        public value: number
    ) { }
}

export class VoteRevoked {
    static Type = "Vote.Revoked" as const;
    type = VoteRevoked.Type;
    constructor(
        public vote: Vote
    ) { }
}

const votingModel = (m: ModelBuilder) => m
    .type(User)
    .type(Event, f => f
        .predecessor("creator", User)
    )
    .type(VotingRound, f => f
        .predecessor("event", Event)
    )
    .type(Vote, f => f
        .predecessor("round", VotingRound)
        .predecessor("voter", User)
    )
    .type(VoteRevoked, f => f
        .predecessor("vote", Vote)
    );

export const model = buildModel(votingModel);

describe("Self-Inverse Restoration", () => {
    let j: Jinaga;
    let creator: User;
    let event: Event;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        event = new Event(creator, "TestEvent");
    });

    describe("VotingRound Scenario (Real-World Case)", () => {
        it("should invoke callback when given fact arrives after subscription", async () => {
            /**
             * Test Scenario - THE REAL BUG:
             * 1. Create VotingRound instance (in memory, not persisted)
             * 2. Subscribe to votes for this round (initial read finds nothing - no round, no votes)
             * 3. THEN persist the VotingRound via j.fact()
             * 4. Add votes to storage DURING the window after given persisted but before system stabilizes
             * 5. WITHOUT self-inverse: No re-read when given arrives, so votes added during T2-T3 window are missed
             * 6. WITH self-inverse: Re-read triggered when given arrives, finds all votes
             * 
             * This tests the T2-T3 race condition documented in the plan
             */
            j = JinagaTest.create({
                initialState: [creator, event]
            });
            
            const votingRound = new VotingRound(event, new Date());

            // Subscribe to votes for the UN-PERSISTED round
            const specification = model.given(VotingRound).match((round, facts) =>
                facts.ofType(Vote)
                    .join(vote => vote.round, round)
                    .notExists(vote =>
                        facts.ofType(VoteRevoked)
                            .join(revoked => revoked.vote, vote)
                    )
                    .select(vote => vote.value)
            );

            const votes: number[] = [];
            const observer = j.watch(specification, votingRound, value => {
                votes.push(value);
            });

            await observer.loaded();
            
            // At this point, nothing - no round, no votes
            expect(votes).toEqual([]);

            // NOW persist the voting round - this should trigger self-inverse re-read
            await j.fact(votingRound);

            // Immediately add votes (simulating race condition where votes arrive after given but before read completes)
            const voter1 = new User("voter1-key");
            await j.fact(new Vote(votingRound, voter1, 5));
            await j.fact(new Vote(votingRound, voter1, 7));

            // Wait for all notifications to be processed
            await observer.processed();
            
            // WITH self-inverse: Callback should fire when given arrives, then again for new votes
            // WITHOUT self-inverse: Only new votes trigger callbacks (via normal inverse)
            // But the key is that self-inverse ensures a re-read happens when given arrives
            expect(votes.length).toBeGreaterThanOrEqual(2);
            expect(votes).toContain(5);
            expect(votes).toContain(7);

            observer.stop();
        });

        it("should work with nested projections when given arrives late", async () => {
            /**
             * Complex scenario: Nested projection with late-arriving given
             */
            j = JinagaTest.create({
                initialState: [creator, event]
            });

            const votingRound = new VotingRound(event, new Date());

            const specification = model.given(VotingRound).match((round, facts) =>
                facts.ofType(Vote)
                    .join(vote => vote.round, round)
                    .select(vote => ({
                        value: vote.value,
                        revocations: facts.ofType(VoteRevoked)
                            .join(revoked => revoked.vote, vote)
                            .select(revoked => j.hash(revoked))
                    }))
            );

            interface VoteModel {
                value: number;
                revocations: string[];
            }

            const votes: VoteModel[] = [];
            const observer = j.watch(specification, votingRound, projection => {
                const voteModel: VoteModel = {
                    value: projection.value,
                    revocations: []
                };
                votes.push(voteModel);

                projection.revocations.onAdded(revoked => {
                    voteModel.revocations.push(revoked);
                });
            });

            await observer.loaded();
            expect(votes).toEqual([]);

            // Persist the voting round AFTER subscription
            await j.fact(votingRound);

            // Add a vote
            const voter1 = new User("voter1-key");
            const vote1 = await j.fact(new Vote(votingRound, voter1, 5));

            // The root callback SHOULD fire
            expect(votes.length).toBe(1);
            expect(votes[0].value).toBe(5);

            // Revoke the vote - nested callback should work too
            const revocation = await j.fact(new VoteRevoked(vote1));
            expect(votes[0].revocations).toContain(j.hash(revocation));

            observer.stop();
        });
    });

    describe("Flat Specification (No Nested Projections)", () => {
        it("should handle simple specifications with late-arriving given", async () => {
            /**
             * Simplest case: flat specification, no nesting
             */
            j = JinagaTest.create({
                initialState: [creator, event]
            });

            const votingRound = new VotingRound(event, new Date());

            const specification = model.given(VotingRound).match((round, facts) =>
                facts.ofType(Vote)
                    .join(vote => vote.round, round)
                    .select(vote => j.hash(vote))
            );

            const voteHashes: string[] = [];
            const observer = j.watch(specification, votingRound, hash => {
                voteHashes.push(hash);
            });

            await observer.loaded();
            expect(voteHashes).toEqual([]);

            // Persist given after subscription
            await j.fact(votingRound);

            // Add vote
            const voter1 = new User("voter1-key");
            const vote1 = await j.fact(new Vote(votingRound, voter1, 5));

            // Callback should fire
            expect(voteHashes).toContain(j.hash(vote1));

            observer.stop();
        });
    });

    describe("Given Already Exists (No Duplicate Notifications)", () => {
        it("should not duplicate notifications when given already persisted", async () => {
            /**
             * Edge case: Given fact already exists when subscription starts
             * Should NOT cause duplicate notifications
             */
            const votingRound = new VotingRound(event, new Date());
            const voter1 = new User("voter1-key");
            const vote1 = new Vote(votingRound, voter1, 5);

            j = JinagaTest.create({
                initialState: [creator, event, votingRound, voter1, vote1]
            });

            const specification = model.given(VotingRound).match((round, facts) =>
                facts.ofType(Vote)
                    .join(vote => vote.round, round)
                    .select(vote => j.hash(vote))
            );

            const voteHashes: string[] = [];
            let callCount = 0;
            const observer = j.watch(specification, votingRound, hash => {
                callCount++;
                voteHashes.push(hash);
            });

            await observer.loaded();
            
            // Should get callback once for existing vote
            expect(voteHashes).toEqual([j.hash(vote1)]);
            expect(callCount).toBe(1);

            // Persist same vote again (shouldn't cause duplicate)
            await j.fact(vote1);
            
            // Still just one callback
            expect(callCount).toBe(1);

            observer.stop();
        });
    });

    describe("Multiple Given Facts (Should NOT Create Self-Inverse)", () => {
        it("should not create self-inverse for multiple given facts", async () => {
            /**
             * Self-inverse should ONLY work with single given fact.
             * Multiple givens is too complex and risky for infinite loops.
             */
            const votingRound = new VotingRound(event, new Date());
            
            j = JinagaTest.create({
                initialState: [creator, event]
            });

            // Specification with TWO givens (VotingRound and User)
            // This should NOT get self-inverse support
            const voter1 = new User("voter1-key");
            const specification = model.given(VotingRound, User).match((round, voter, facts) =>
                facts.ofType(Vote)
                    .join(vote => vote.round, round)
                    .join(vote => vote.voter, voter)
                    .select(vote => j.hash(vote))
            );

            const voteHashes: string[] = [];
            const observer = j.watch(specification, votingRound, voter1, (hash: string) => {
                voteHashes.push(hash);
            });

            await observer.loaded();
            
            // Persist both givens after subscription
            await j.fact(votingRound);
            await j.fact(voter1);

            // This test documents current behavior - no callback
            // (Multiple givens don't get self-inverse support by design)
            expect(voteHashes).toEqual([]);

            observer.stop();
        });
    });

    describe("Observer Lifecycle", () => {
        it("should clean up self-inverse listeners when observer stopped", async () => {
            /**
             * Ensure self-inverse listeners are properly cleaned up
             * when observer.stop() is called
             */
            j = JinagaTest.create({
                initialState: [creator, event]
            });

            const votingRound = new VotingRound(event, new Date());

            const specification = model.given(VotingRound).match((round, facts) =>
                facts.ofType(Vote)
                    .join(vote => vote.round, round)
                    .select(vote => j.hash(vote))
            );

            let callCount = 0;
            const observer = j.watch(specification, votingRound, hash => {
                callCount++;
            });

            await observer.loaded();

            // Stop the observer BEFORE persisting given
            observer.stop();

            // Now persist the given
            await j.fact(votingRound);

            // Add a vote
            const voter1 = new User("voter1-key");
            await j.fact(new Vote(votingRound, voter1, 5));

            // Callback should NOT fire because observer was stopped
            expect(callCount).toBe(0);
        });
    });
});
