import { DistributionRules, JinagaTest, Trace, User } from "@src";
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

    it("delivers a row once when two rules authorize it", async () => {
        // Two rules over the same share-spec are ORed into two branches. A row
        // both branches authorize must reach the read's starting rows once.
        const office = new Office(company, "Office1");
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
