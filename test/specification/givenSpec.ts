import { SpecificationOf } from "../../src/specification/given";
import { model, Company, Office, OfficeClosed, President, UserName, User } from "./model";

describe("given", () => {
    it("should parse a successor join", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                ]
            } => u1`);
    });

    it("should parse negative existential condition", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office => facts.ofType(OfficeClosed)
                    .join(officeClosed => officeClosed.office, office)
                )
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                    !E {
                        u2: Office.Closed [
                            u2->office: Office = u1
                        ]
                    }
                ]
            } => u1`);
    });

    it("should parse positive existential condition", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .exists(office => facts.ofType(OfficeClosed)
                    .join(officeClosed => officeClosed.office, office)
                )
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                    E {
                        u2: Office.Closed [
                            u2->office: Office = u1
                        ]
                    }
                ]
            } => u1`);
    });

    it("should parse nested negative existential condition", () => {
        const specification = model.given(Company).match((company, facts) =>
            Office.inCompany(facts, company)
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                    !E {
                        u2: Office.Closed [
                            u2->office: Office = u1
                            !E {
                                u3: Office.Reopened [
                                    u3->officeClosed: Office.Closed = u2
                                ]
                            }
                        ]
                    }
                ]
            } => u1`);
    });

    it("should parse a field projection", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => office.identifier)
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                ]
            } => u1.identifier`);
    });

    it("should parse a composite projection with a field", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier
                }))
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                ]
            } => {
                identifier = u1.identifier
            }`);
    });

    it("should parse a composite projection with a collection", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier,
                    presidents: facts.ofType(President)
                        .join(president => president.office, office)
                }))
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                ]
            } => {
                identifier = u1.identifier
                presidents = {
                    u2: President [
                        u2->office: Office = u1
                    ]
                } => u2
            }`);
    });

    it("should parse a nested collection", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier,
                    presidents: facts.ofType(President)
                        .join(president => president.office, office)
                        .select(president => ({
                            president: president,
                            names: facts.ofType(UserName)
                                .join(userName => userName.user, president.user)
                                .select(userName => userName.value)
                        }))
                }))
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                ]
            } => {
                identifier = u1.identifier
                presidents = {
                    u2: President [
                        u2->office: Office = u1
                    ]
                } => {
                    names = {
                        u3: User.Name [
                            u3->user: User = u2->user: User
                        ]
                    } => u3.value
                    president = u2
                }
            }`);
    });

    it("should parse multiple joins", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier,
                    presidents: facts.ofType(President)
                        .join(president => president.office, office)
                        .select(president => ({
                            president: president,
                            names: facts.ofType(UserName)
                                .join(userName => userName.user, president.user)
                                .notExists(userName => facts.ofType(UserName)
                                    .join(next => next.prior, userName)
                                    .join(next => next.user, president.user)
                                )
                                .select(userName => userName.value)
                        }))
                }))
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                ]
            } => {
                identifier = u1.identifier
                presidents = {
                    u2: President [
                        u2->office: Office = u1
                    ]
                } => {
                    names = {
                        u3: User.Name [
                            u3->user: User = u2->user: User
                            !E {
                                u4: User.Name [
                                    u4->prior: User.Name = u3
                                    u4->user: User = u2->user: User
                                ]
                            }
                        ]
                    } => u3.value
                    president = u2
                }
            }`);
    });

    it("should parse multiple joins in opposite order", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier,
                    presidents: facts.ofType(President)
                        .join(president => president.office, office)
                        .select(president => ({
                            president: president,
                            names: facts.ofType(UserName)
                                .join(userName => userName.user, president.user)
                                .notExists(userName => facts.ofType(UserName)
                                    .join(next => next.user, president.user)
                                    .join(next => next.prior, userName)
                                )
                                .select(userName => userName.value)
                        }))
                }))
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                ]
            } => {
                identifier = u1.identifier
                presidents = {
                    u2: President [
                        u2->office: Office = u1
                    ]
                } => {
                    names = {
                        u3: User.Name [
                            u3->user: User = u2->user: User
                            !E {
                                u4: User.Name [
                                    u4->user: User = u2->user: User
                                    u4->prior: User.Name = u3
                                ]
                            }
                        ]
                    } => u3.value
                    president = u2
                }
            }`);
    });

    it("should parse select many", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier,
                    presidents: facts.ofType(President)
                        .join(president => president.office, office)
                        .selectMany(president => facts.ofType(User)
                            .join(user => user, president.user)
                            .select(user => ({
                                user: user,
                                names: facts.ofType(UserName)
                                    .join(userName => userName.user, user)
                                    .select(userName => userName.value)
                            }))
                        )
                }))
        );

        expectSpecification(specification, `
            (p1: Company) {
                u1: Office [
                    u1->company: Company = p1
                ]
            } => {
                identifier = u1.identifier
                presidents = {
                    u2: President [
                        u2->office: Office = u1
                    ]
                    u3: User [
                        u3 = u2->user: User
                    ]
                } => {
                    names = {
                        u4: User.Name [
                            u4->user: User = u3
                        ]
                    } => u4.value
                    user = u3
                }
            }`);
    });

    it("should parse multiple givens", () => {
        const specification = model.given(Company, User).match((company, user, facts) =>
            facts.ofType(President)
                .join(president => president.office.company, company)
                .join(president => president.user, user)
        );

        expectSpecification(specification, `
            (p1: Company, p2: User) {
                u1: President [
                    u1->office: Office->company: Company = p1
                    u1->user: User = p2
                ]
            } => u1`);
    });
});

function expectSpecification<T, U>(specification: SpecificationOf<T, U>, expected: string) {
    expect("\n" + specification.toDescriptiveString(3)).toBe(expected + "\n");
}
