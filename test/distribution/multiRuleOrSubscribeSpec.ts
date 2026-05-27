import { DistributionRules, JinagaTest, Trace, User } from "@src";
import {
    Administrator,
    AdministratorRevoked,
    Company,
    Office,
    President,
    model
} from "../companyModel";

// When two distribution rules independently authorize the same target shape
// (e.g. "the comments on a post are visible to its author OR to a member of
// a private group"), the previous behaviour was to refuse intersection on
// the grounds that the spec language has no OR primitive. That left a user
// authorized by either rule unable to subscribe — even though either rule's
// auth fact would suffice. The engine treats rules as OR everywhere else
// (canDistributeTo returns success on first match), so the subscribe path
// now does the same: produce one intersected branch per matching rule,
// subscribe to all of them in parallel, and dedup at the observer.
describe("subscribe with multi-rule OR authorization", () => {
    Trace.off();

    const creator = new User("creator");
    const subscriber = new User("subscriber");
    const company = new Company(creator, "Co");

    // Two rules with the same share-spec (Company → Office) and distinct
    // user-spec shapes. Either path authorizes the subscriber.
    const distribution = (r: DistributionRules) => r
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

    const targetSpec = model.given(Company).match((c, facts) =>
        facts.ofType(Office).join(o => o.company, c)
    );

    it("activates the subscription when the Administrator auth fact arrives", async () => {
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [creator, subscriber, company, office],
            distribution
        });

        const offices: string[] = [];
        const observer = j.subscribe(
            targetSpec,
            company,
            o => { offices.push(j.hash(o)); }
        );

        await observer.loaded();
        expect(offices).toEqual([]);

        await j.fact(new Administrator(company, subscriber, new Date("2026-05-26")));
        await observer.processed();
        observer.stop();

        expect(offices).toContain(j.hash(office));
    });

    it("activates the subscription when the President auth fact arrives", async () => {
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [creator, subscriber, company, office],
            distribution
        });

        const offices: string[] = [];
        const observer = j.subscribe(
            targetSpec,
            company,
            o => { offices.push(j.hash(o)); }
        );

        await observer.loaded();
        expect(offices).toEqual([]);

        await j.fact(new President(office, subscriber));
        await observer.processed();
        observer.stop();

        expect(offices).toContain(j.hash(office));
    });

    it("keeps the row when one of two authorizations is revoked and the other still holds", async () => {
        // Rule A admits the subscriber via Administrator *unless* it has
        // been revoked — so revoking the admin fires a "remove" inverse on
        // branch A. Rule B (President) is unchanged.
        const distributionWithRevocation = (r: DistributionRules) => r
            .share(model.given(Company).match((c, facts) =>
                facts.ofType(Office).join(o => o.company, c)
            ))
            .with(model.given(Company).match((c, facts) =>
                facts.ofType(Administrator)
                    .join(a => a.company, c)
                    .notExists(a => facts.ofType(AdministratorRevoked).join(r => r.administrator, a))
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

        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [creator, subscriber, company, office],
            distribution: distributionWithRevocation
        });

        const offices: string[] = [];
        const observer = j.subscribe(
            targetSpec,
            company,
            o => {
                const hash = j.hash(o);
                offices.push(hash);
                return () => {
                    const i = offices.indexOf(hash);
                    if (i >= 0) offices.splice(i, 1);
                };
            }
        );

        await observer.loaded();
        expect(offices).toEqual([]);

        // Both auth facts arrive, then the admin one is revoked. The OR
        // accounting at the observer must keep the office in the result
        // set because the president authorization still holds.
        const administrator = new Administrator(company, subscriber, new Date("2026-05-26"));
        await j.fact(administrator);
        await j.fact(new President(office, subscriber));
        await observer.processed();
        expect(offices).toEqual([j.hash(office)]);

        await j.fact(new AdministratorRevoked(administrator));
        await observer.processed();
        observer.stop();

        expect(offices).toEqual([j.hash(office)]);
    });

    // Control test: in single-rule mode (no OR), revoking the only auth
    // should remove the row. If this passes, removal callbacks actually
    // fire through intersected specs — and the multi-rule "row stays"
    // test above is a real assertion, not vacuously true.
    it("control: single-rule intersection — revoking the only auth removes the row", async () => {
        const singleRuleWithRevocation = (r: DistributionRules) => r
            .share(model.given(Company).match((c, facts) =>
                facts.ofType(Office).join(o => o.company, c)
            ))
            .with(model.given(Company).match((c, facts) =>
                facts.ofType(Administrator)
                    .join(a => a.company, c)
                    .notExists(a => facts.ofType(AdministratorRevoked).join(r => r.administrator, a))
                    .selectMany(a => facts.ofType(User).join(u => u, a.user))
            ));

        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [creator, subscriber, company, office],
            distribution: singleRuleWithRevocation
        });

        const offices: string[] = [];
        const observer = j.subscribe(
            targetSpec,
            company,
            o => {
                const hash = j.hash(o);
                offices.push(hash);
                return () => {
                    const i = offices.indexOf(hash);
                    if (i >= 0) offices.splice(i, 1);
                };
            }
        );

        await observer.loaded();
        const administrator = new Administrator(company, subscriber, new Date("2026-05-26"));
        await j.fact(administrator);
        await observer.processed();
        expect(offices).toEqual([j.hash(office)]);

        await j.fact(new AdministratorRevoked(administrator));
        await observer.processed();
        observer.stop();

        expect(offices).toEqual([]);
    });

    it("delivers each row exactly once when both rules authorize the subscriber", async () => {
        const office = new Office(company, "Office1");
        const j = JinagaTest.create({
            model,
            user: subscriber,
            initialState: [creator, subscriber, company, office],
            distribution
        });

        const offices: string[] = [];
        const observer = j.subscribe(
            targetSpec,
            company,
            o => { offices.push(j.hash(o)); }
        );

        await observer.loaded();
        expect(offices).toEqual([]);

        // Both auth facts arrive — either rule alone authorizes the office.
        // Dedup at the observer must collapse them to a single delivery.
        await j.fact(new Administrator(company, subscriber, new Date("2026-05-26")));
        await j.fact(new President(office, subscriber));
        await observer.processed();
        observer.stop();

        expect(offices).toEqual([j.hash(office)]);
    });
});
