import { describeSpecification, JinagaTest, User } from "@src";
import {
    Company,
    Manager,
    ManagerName,
    ManagerTerminated,
    model,
    Office,
    OfficeClosed,
    OfficeReopened
} from "../companyModel";

// Issue #304: the current-value and not-deleted idioms were spelled out in
// full at every read site. `whereCurrent`, `whereNotDeleted` and
// `whereNotDeletedOrRestored` name them once on `Traversal`.
//
// Each helper is a pure expansion into the existential condition the
// hand-written form produces, so the two descriptions -- and therefore the
// feed hash -- must be identical. The expectation below is computed from the
// hand-written specification rather than quoted, so it moves when the
// expansion moves.

const currentManagerNameByHelper = model.given(Manager).match(manager =>
    manager.successors(ManagerName, name => name.manager)
        .whereCurrent(ManagerName, next => next.prior)
        .select(name => name.value)
);

const currentManagerNameByHand = model.given(Manager).match(manager =>
    manager.successors(ManagerName, name => name.manager)
        .notExists(name => name.successors(ManagerName, next => next.prior))
        .select(name => name.value)
);

const activeManagersByHelper = model.given(Office).match((office, facts) =>
    facts.ofType(Manager)
        .join(manager => manager.office, office)
        .whereNotDeleted(ManagerTerminated, terminated => terminated.manager)
        .select(manager => manager.employeeNumber)
);

const activeManagersByHand = model.given(Office).match((office, facts) =>
    facts.ofType(Manager)
        .join(manager => manager.office, office)
        .notExists(manager => manager.successors(ManagerTerminated, terminated => terminated.manager))
        .select(manager => manager.employeeNumber)
);

const openOfficesByHelper = model.given(Company).match((company, facts) =>
    facts.ofType(Office)
        .join(office => office.company, company)
        .whereNotDeletedOrRestored(
            OfficeClosed, closed => closed.office,
            OfficeReopened, reopened => reopened.officeClosed)
        .select(office => office.identifier)
);

const openOfficesByHand = model.given(Company).match((company, facts) =>
    facts.ofType(Office)
        .join(office => office.company, company)
        .notExists(office => office.successors(OfficeClosed, closed => closed.office)
            .notExists(closed => closed.successors(OfficeReopened, reopened => reopened.officeClosed)))
        .select(office => office.identifier)
);

describe("Specification idiom helpers", () => {
    it("describes whereCurrent exactly as the hand-written exclusion does", () => {
        expect(describeSpecification(currentManagerNameByHelper.specification, 0))
            .toEqual(describeSpecification(currentManagerNameByHand.specification, 0));
    });

    it("describes whereNotDeleted exactly as the hand-written exclusion does", () => {
        expect(describeSpecification(activeManagersByHelper.specification, 0))
            .toEqual(describeSpecification(activeManagersByHand.specification, 0));
    });

    it("describes whereNotDeletedOrRestored exactly as the hand-written exclusion does", () => {
        expect(describeSpecification(openOfficesByHelper.specification, 0))
            .toEqual(describeSpecification(openOfficesByHand.specification, 0));
    });

    it("returns only the latest value after three successive revisions", async () => {
        const j = JinagaTest.create({ model });
        const creator = await j.fact(new User("---CREATOR---"));
        const company = await j.fact(new Company(creator, "contoso"));
        const office = await j.fact(new Office(company, "dallas"));
        const manager = await j.fact(new Manager(office, 1));

        const first = await j.fact(new ManagerName(manager, "First", []));
        const second = await j.fact(new ManagerName(manager, "Second", [first]));
        await j.fact(new ManagerName(manager, "Third", [second]));

        const names = await j.query(currentManagerNameByHelper, manager);

        expect(names).toEqual(["Third"]);
    });

    it("returns both values of a concurrent revision that shares a prior", async () => {
        const j = JinagaTest.create({ model });
        const creator = await j.fact(new User("---CREATOR---"));
        const company = await j.fact(new Company(creator, "contoso"));
        const office = await j.fact(new Office(company, "dallas"));
        const manager = await j.fact(new Manager(office, 1));

        const first = await j.fact(new ManagerName(manager, "First", []));
        await j.fact(new ManagerName(manager, "Left", [first]));
        await j.fact(new ManagerName(manager, "Right", [first]));

        const names = await j.query(currentManagerNameByHelper, manager);

        expect(names.sort()).toEqual(["Left", "Right"]);
    });

    it("excludes a deleted entity that has no restoration", async () => {
        const j = JinagaTest.create({ model });
        const creator = await j.fact(new User("---CREATOR---"));
        const company = await j.fact(new Company(creator, "contoso"));
        const office = await j.fact(new Office(company, "dallas"));
        const active = await j.fact(new Manager(office, 1));
        const terminated = await j.fact(new Manager(office, 2));
        await j.fact(new ManagerTerminated(terminated, new Date(2026, 1, 1)));

        const employeeNumbers = await j.query(activeManagersByHelper, office);

        expect(employeeNumbers).toEqual([active.employeeNumber]);
    });

    it("returns an entity that was deleted and then restored", async () => {
        const j = JinagaTest.create({ model });
        const creator = await j.fact(new User("---CREATOR---"));
        const company = await j.fact(new Company(creator, "contoso"));
        const office = await j.fact(new Office(company, "dallas"));
        const closed = await j.fact(new OfficeClosed(office, new Date(2026, 1, 1)));
        await j.fact(new OfficeReopened(closed));

        const identifiers = await j.query(openOfficesByHelper, company);

        expect(identifiers).toEqual(["dallas"]);
    });

    it("excludes an entity deleted again after a restoration", async () => {
        const j = JinagaTest.create({ model });
        const creator = await j.fact(new User("---CREATOR---"));
        const company = await j.fact(new Company(creator, "contoso"));
        const office = await j.fact(new Office(company, "dallas"));
        const closed = await j.fact(new OfficeClosed(office, new Date(2026, 1, 1)));
        await j.fact(new OfficeReopened(closed));
        await j.fact(new OfficeClosed(office, new Date(2026, 2, 1)));

        const identifiers = await j.query(openOfficesByHelper, company);

        expect(identifiers).toEqual([]);
    });
});
