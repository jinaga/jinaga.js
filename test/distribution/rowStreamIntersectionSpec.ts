import {
    AuthenticationNoOp, DistributionRules, FactEnvelope, FactManager, FactReference, FeedResponse,
    FeedsResponse, Jinaga, JinagaTest, MemoryStore, Network, NoOpTracer, ObservableSource,
    PassThroughFork, Specification, SyncStatusNotifier, Trace, Tracer, User
} from "@src";
import { Administrator, Company, Office, President, model } from "../companyModel";

// Issue #279: `subscribeRows` resolved its feed without the distribution-rule
// intersection that `j.subscribe` performs, so a specification authorized only
// through an intersected rule delivered nothing — reported as `reactive` by the
// replicator, and refused outright by the in-process engine. The workaround was
// a distribution rule per consumer matching the consumer's own specification
// character for character.
describe("subscribeRows with distribution-rule intersection (#279)", () => {
    Trace.off();

    const creator = new User("creator");
    const subscriber = new User("subscriber");
    const otherUser = new User("other");
    const company = new Company(creator, "Co");

    const officesOfCompany = model.given(Company).match((c, facts) =>
        facts.ofType(Office)
            .join(o => o.company, c)
    );

    // Share Company → Office with the company's administrators. The subscriber
    // is not an administrator when the stream starts.
    const distribution = (r: DistributionRules) => r
        .share(model.given(Company).match((c, facts) =>
            facts.ofType(Office)
                .join(o => o.company, c)
        ))
        .with(model.given(Company).match((c, facts) =>
            facts.ofType(Administrator)
                .join(a => a.company, c)
                .selectMany(a => facts.ofType(User).join(u => u, a.user))
        ));

    it("delivers the backlog when the authorizing fact arrives", async () => {
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [creator, subscriber, company, office],
            distribution
        });

        const stream = await j.subscribeRows(officesOfCompany, company);
        const changes = stream[Symbol.asyncIterator]();

        // Not yet authorized: the stream starts, and starts empty.
        expect(stream.pending).toEqual(0);

        await j.fact(new Administrator(company, subscriber, new Date("2026-05-26")));

        const first = await changes.next();
        expect(first.value.operation).toEqual("added");
        expect(j.hash(first.value.result)).toEqual(j.hash(office));

        stream.stop();
    });

    it("delivers the rows that already match when the user is already authorized", async () => {
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [
                creator, subscriber, company, office,
                new Administrator(company, subscriber, new Date("2026-05-26"))
            ],
            distribution
        });

        const stream = await j.subscribeRows(officesOfCompany, company);
        const changes = stream[Symbol.asyncIterator]();

        const first = await changes.next();
        expect(j.hash(first.value.result)).toEqual(j.hash(office));

        stream.stop();
    });

    it("gives an intersected row the same rowHash that queryRows gives it", async () => {
        // Intersection appends synthetic auth labels to the specification. Row
        // identity must stay pre-intersection, or a consumer could not
        // deduplicate its periodic sweep against the stream.
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [
                creator, subscriber, company, office,
                new Administrator(company, subscriber, new Date("2026-05-26"))
            ],
            distribution
        });

        const stream = await j.subscribeRows(officesOfCompany, company);
        const changes = stream[Symbol.asyncIterator]();
        const streamed = await changes.next();

        const queried = await j.queryRows(officesOfCompany, company);
        expect(queried).toHaveLength(1);
        expect(streamed.value.rowHash).toEqual(queried[0].rowHash);

        stream.stop();
    });

    it("stays empty when the authorizing fact names a different user", async () => {
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [creator, subscriber, otherUser, company, office],
            distribution
        });

        const stream = await j.subscribeRows(officesOfCompany, company);

        await j.fact(new Administrator(company, otherUser, new Date("2026-05-26")));

        expect(stream.pending).toEqual(0);

        stream.stop();
    });

    // Two rules over the same share-spec are ORed into two branches.
    const twoRules = (r: DistributionRules) => r
            .share(model.given(Company).match((c, facts) =>
                facts.ofType(Office).join(o => o.company, c)
            ))
            .with(model.given(Company).match((c, facts) =>
                facts.ofType(Administrator)
                    .join(a => a.company, c)
                    .selectMany(a => facts.ofType(User).join(u => u, a.user))
            ))
            .share(model.given(Company).match((c, facts) =>
                facts.ofType(Office).join(o => o.company, c)
            ))
            .with(model.given(Company).match((c, facts) =>
                facts.ofType(President)
                    .join(p => p.office.company, c)
                    .selectMany(p => facts.ofType(User).join(u => u, p.user))
            ));

    /**
     * The branch count the stream actually fanned out to, read from the trace
     * the start emits. Two rules in the rule set do not imply two branches:
     * `intersectForSubscribe` intersects only when the user is not already
     * authorized, so what a test needs to pin is the fan-out, not the rules.
     */
    async function branchesOnStart(start: () => Promise<{ stop(): void }>): Promise<number> {
        const lines: string[] = [];
        Trace.configure(new class extends NoOpTracer implements Tracer {
            info(message: string): void {
                if (message.includes("[RowStream] START")) {
                    lines.push(message);
                }
            }
        }());
        let stream;
        try {
            stream = await start();
        }
        finally {
            Trace.configure(new NoOpTracer());
        }
        stream.stop();
        const match = /Branches: (\d+)/.exec(lines[0]);
        return Number(match![1]);
    }

    it("fans out to one branch per rule when the user is not yet authorized", async () => {
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [creator, subscriber, company, office],
            distribution: twoRules
        });

        expect(await branchesOnStart(() => j.subscribeRows(officesOfCompany, company)))
            .toEqual(2);
    });

    it("starts on whichever of two ORed rules authorizes the user", async () => {
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [creator, subscriber, company, office],
            distribution: twoRules
        });

        const stream = await j.subscribeRows(officesOfCompany, company);
        const changes = stream[Symbol.asyncIterator]();

        // Neither auth fact exists yet, so the read that starts the stream
        // finds nothing on either branch.
        expect(stream.pending).toEqual(0);

        // The President branch alone authorizes the row.
        await j.fact(new President(office, subscriber));
        const first = await changes.next();
        expect(j.hash(first.value.result)).toEqual(j.hash(office));

        stream.stop();
    });

    it("does not fan out when the user is already authorized outright", async () => {
        // Both auth facts present: `canDistributeToAll` succeeds, so the
        // intersection is a passthrough and the rule count is irrelevant.
        // This is why holding both auth facts does NOT exercise the
        // cross-branch read — that needs the stub below.
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [
                creator, subscriber, company, office,
                new Administrator(company, subscriber, new Date("2026-05-26")),
                new President(office, subscriber)
            ],
            distribution: twoRules
        });

        expect(await branchesOnStart(() => j.subscribeRows(officesOfCompany, company)))
            .toEqual(1);
    });

    it("delivers a row once when two branches both match it", async () => {
        // The cross-branch dedup in `deliverStartingRows`, at the level of the
        // mechanism rather than end to end. A network that hands back two
        // branches matching the same rows is what an OR over two rules looks
        // like to the row stream; the in-process engine cannot produce that
        // state deterministically, because a rule whose auth fact is present
        // authorizes the user outright and collapses the fan-out (above).
        //
        // Without the dedup this office arrives twice.
        class TwoBranchNetwork implements Network {
            feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
                return Promise.resolve({ feeds: ["feed-one"] });
            }

            fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
                return Promise.resolve({ references: [], bookmark });
            }

            streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>): () => void {
                void onResponse([], bookmark);
                return () => { };
            }

            load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
                return Promise.resolve([]);
            }

            async intersectForSubscribe(start: FactReference[], specification: Specification) {
                return [
                    { start, specification },
                    { start, specification }
                ];
            }
        }

        const store = new MemoryStore();
        const factManager = new FactManager(
            new PassThroughFork(store), new ObservableSource(store), store, new TwoBranchNetwork(), []);
        const j = new Jinaga(new AuthenticationNoOp(), factManager, new SyncStatusNotifier());

        const persistedCreator = await j.fact(creator);
        const persistedCompany = await j.fact(new Company(persistedCreator, "Co"));
        const office = await j.fact(new Office(persistedCompany, "Office1"));

        const stream = await j.subscribeRows(officesOfCompany, persistedCompany);
        try {
            // `pending` is exact, and nothing has been consumed yet, so this is
            // the whole starting set: the second branch's copy of the same row
            // was collapsed rather than queued. Read before consuming, so a
            // regression fails this assertion rather than parking a consumer
            // on a `next()` that never resolves.
            expect(stream.pending).toEqual(1);

            const changes = stream[Symbol.asyncIterator]();
            const first = await changes.next();
            expect(j.hash(first.value.result)).toEqual(j.hash(office));
        }
        finally {
            // Release the held feed even when an assertion above fails, so a
            // failure is reported rather than hanging the run on an open feed.
            stream.stop();
        }
    });

    it("holds a feed for every branch, and releases them all on stop", async () => {
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [
                creator, subscriber, company, office,
                new Administrator(company, subscriber, new Date("2026-05-26"))
            ],
            distribution
        });

        const stream = await j.subscribeRows(officesOfCompany, company);
        // A second stream over the same specification proves the first
        // released its feeds: a leaked subscriber would keep them registered.
        stream.stop();

        const second = await j.subscribeRows(officesOfCompany, company);
        const changes = second[Symbol.asyncIterator]();
        expect(j.hash((await changes.next()).value.result)).toEqual(j.hash(office));
        second.stop();
    });
});
