import { DistributionRules, JinagaTest, Trace, User } from "@src";
import {
    Administrator,
    Company,
    Employee,
    Office,
    OfficeClosed,
    model
} from "../companyModel";

// Phase 3 of the j.subscribe trust release: when subscribe runs on a feed
// that the user isn't yet authorized for, the call should succeed (returning
// empty) and later push results when the authorizing fact arrives — no
// client-side retry, no observer.loaded().catch() guard. The mechanism is
// distribution-rule intersection: the authorization pattern becomes a fact
// pattern the existing inverse engine already handles.
describe("subscribe with distribution-rule intersection (Phase 3, #130)", () => {
    Trace.off();

    const creator = new User("creator");
    const subscriber = new User("subscriber");
    const company = new Company(creator, "Co");

    describe("plain subscribe on an initially-forbidden feed", () => {
        // Rule: share Company→Office with users who are administrators of
        // the company. Subscriber is not yet an administrator.
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

        it("succeeds with empty results, then pushes when the auth fact arrives", async () => {
            const office = new Office(company, "Office1");
            const j = JinagaTest.create({
                model,
                user: subscriber,
                // Seed the local store with descendants but withhold the
                // authorizing Administrator fact. Without Phase 3, subscribe
                // would throw "Not authorized" because no rule grants the
                // subscriber access.
                initialState: [creator, subscriber, company, office],
                distribution
            });

            const offices: string[] = [];
            const observer = j.subscribe(
                model.given(Company).match((c, facts) =>
                    facts.ofType(Office)
                        .join(o => o.company, c)
                ),
                company,
                o => {
                    offices.push(j.hash(o));
                }
            );

            // Phase 3 contract: subscribe must succeed even though the user
            // is not currently authorized — no Forbidden, no retry.
            await observer.loaded();
            expect(offices).toEqual([]);

            // The authorizing fact arrives. The intersected spec's inverses
            // include the Administrator pattern, so the existing inverse
            // engine fires and surfaces the previously-withheld office.
            const administrator = new Administrator(company, subscriber, new Date("2026-05-26"));
            await j.fact(administrator);
            await observer.processed();
            observer.stop();

            expect(offices).toContain(j.hash(office));
        });

        it("stays empty when the auth fact is for a different user", async () => {
            const otherUser = new User("other");
            const office = new Office(company, "Office1");
            const j = JinagaTest.create({
                model,
                user: subscriber,
                initialState: [creator, subscriber, otherUser, company, office],
                distribution
            });

            const offices: string[] = [];
            const observer = j.subscribe(
                model.given(Company).match((c, facts) =>
                    facts.ofType(Office)
                        .join(o => o.company, c)
                ),
                company,
                o => {
                    offices.push(j.hash(o));
                }
            );

            await observer.loaded();
            expect(offices).toEqual([]);

            // Administrator linking a *different* user — doesn't satisfy
            // the intersected auth pattern for `subscriber`.
            await j.fact(new Administrator(company, otherUser, new Date("2026-05-26")));
            await observer.processed();
            observer.stop();

            expect(offices).toEqual([]);
        });
    });

    describe("intersection composes with .notExists() (#196 negating-feed shape)", () => {
        // Share the .notExists() spec itself with administrators. The share
        // spec contains the negating successor, so intersection needs to
        // produce a feed-builder shape that doesn't drop the negation.
        const distribution = (r: DistributionRules) => r
            .share(model.given(Company).match((c, facts) =>
                facts.ofType(Office)
                    .join(o => o.company, c)
                    .notExists(o => facts.ofType(OfficeClosed)
                        .join(oc => oc.office, o)
                    )
            ))
            .with(model.given(Company).match((c, facts) =>
                facts.ofType(Administrator)
                    .join(a => a.company, c)
                    .selectMany(a => facts.ofType(User).join(u => u, a.user))
            ));

        it("subscribes to a .notExists() spec and pushes when admin is granted", async () => {
            const openOffice = new Office(company, "Open");
            const closedOffice = new Office(company, "Closed");
            const j = JinagaTest.create({
                model,
                user: subscriber,
                initialState: [
                    creator, subscriber, company, openOffice, closedOffice,
                    new OfficeClosed(closedOffice, new Date("2026-05-26"))
                ],
                distribution
            });

            const offices: string[] = [];
            const observer = j.subscribe(
                model.given(Company).match((c, facts) =>
                    facts.ofType(Office)
                        .join(o => o.company, c)
                        .notExists(o => facts.ofType(OfficeClosed)
                            .join(oc => oc.office, o)
                        )
                ),
                company,
                o => {
                    offices.push(j.hash(o));
                }
            );

            await observer.loaded();
            expect(offices).toEqual([]);

            await j.fact(new Administrator(company, subscriber, new Date("2026-05-26")));
            await observer.processed();
            observer.stop();

            // The open office surfaces; the closed one does not (the
            // negating branch still works after intersection).
            expect(offices).toContain(j.hash(openOffice));
            expect(offices).not.toContain(j.hash(closedOffice));
        });
    });

    describe("authorization bypass via forged intersection marker", () => {
        // Distribution checks must not be skippable by a caller who crafts
        // a spec carrying a `distributionUser: Jinaga.User` given. The
        // bypass for genuine intersected specs is keyed off feed hashes the
        // engine itself produced, not off spec structure.
        const distribution = (r: DistributionRules) => r
            .share(model.given(Company).match((c, facts) =>
                facts.ofType(Office).join(o => o.company, c)
            ))
            .with(model.given(Company).match((c, facts) =>
                facts.ofType(Administrator)
                    .join(a => a.company, c)
                    .selectMany(a => facts.ofType(User).join(u => u, a.user))
            ));

        it("rejects a query whose spec was hand-crafted to look intersected", async () => {
            const office = new Office(company, "Office1");
            const j = JinagaTest.create({
                model,
                user: subscriber,
                initialState: [creator, subscriber, company, office],
                distribution
            });

            // A query that should be Forbidden (no Administrator yet) but
            // whose spec has been authored with the synthetic given. If the
            // engine treated the spec-structure marker as a bypass, this
            // would silently leak offices. It must instead reject — either
            // by failing authorization or by failing the connectedness
            // check (the forged given has no link to the rest of the spec).
            const forgedSpec = model.given(Company, User).match((c, distributionUser, facts) =>
                facts.ofType(Office).join(o => o.company, c)
            );
            await expect(() =>
                j.query(forgedSpec, company, subscriber)
            ).rejects.toThrow(/Not authorized|Disconnected specification/);
        });
    });

    describe("intersection composes with multi-given share/with rules (#161 shape)", () => {
        // Both share and with specs have two givens (Company, User). The
        // share-spec joins Employee to *both* givens (its match references
        // each one), and the with-spec derives the authorized user via an
        // Administrator linking the two givens.
        const distribution = (r: DistributionRules) => r
            .share(model.given(Company, User).match((c, user, facts) =>
                facts.ofType(Employee)
                    .join(e => e.office.company, c)
                    .join(e => e.user, user)
            ))
            .with(model.given(Company, User).match((c, user, facts) =>
                facts.ofType(Administrator)
                    .join(a => a.company, c)
                    .selectMany(a => facts.ofType(User).join(u => u, a.user))
            ));

        it("subscribes to a multi-given spec and pushes when admin is granted", async () => {
            const office = new Office(company, "Office1");
            const employee = new Employee(office, subscriber);
            const j = JinagaTest.create({
                model,
                user: subscriber,
                initialState: [creator, subscriber, company, office, employee],
                distribution
            });

            const employees: string[] = [];
            const observer = j.subscribe(
                model.given(Company, User).match((c, user, facts) =>
                    facts.ofType(Employee)
                        .join(e => e.office.company, c)
                        .join(e => e.user, user)
                ),
                company,
                subscriber,
                e => {
                    employees.push(j.hash(e));
                }
            );

            await observer.loaded();
            expect(employees).toEqual([]);

            await j.fact(new Administrator(company, subscriber, new Date("2026-05-26")));
            await observer.processed();
            observer.stop();

            expect(employees).toContain(j.hash(employee));
        });
    });
});
