import { SpecificationOf } from "../../src";
import { Company, Office, OfficeClosed, OfficeReopened, President, User, UserName, model } from "../companyModel";

describe("given", () => {
    it("should parse an identity specification", () => {
        const specification = model.given(Company).select((company, facts) => company);

        expectSpecification(specification, `
            (p1: Company) {
            } => p1`);
    });

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

    it("should parse a successor join using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
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

    it("should parse negative existential condition using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .notExists(office => office.successors(OfficeClosed, officeClosed => officeClosed.office))
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

    it("should parse positive existential condition using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .exists(office => office.successors(OfficeClosed, officeClosed => officeClosed.office))
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

    it("should parse nested negative existential condition using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .notExists(office => office.successors(OfficeClosed, officeClosed => officeClosed.office)
                    .notExists(officeClosed => officeClosed.successors(OfficeReopened, officeReopened => officeReopened.officeClosed))
                )
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

    it("should parse a field projection using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
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

    it("should parse a composite projection with a field using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
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

    it("should parse a composite projection with a collection using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => ({
                    identifier: office.identifier,
                    presidents: office.successors(President, president => president.office)
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

    it("should parse a nested collection using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => ({
                    identifier: office.identifier,
                    presidents: office.successors(President, president => president.office)
                        .select(president => ({
                            president: president,
                            names: president.user.successors(UserName, userName => userName.user)
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

    it("should parse multiple joins using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => ({
                    identifier: office.identifier,
                    presidents: office.successors(President, president => president.office)
                        .select(president => ({
                            president: president,
                            names: president.user.successors(UserName, userName => userName.user)
                                .notExists(userName => userName.successors(UserName, next => next.prior)
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

    it("should parse multiple joins in opposite order using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => ({
                    identifier: office.identifier,
                    presidents: office.successors(President, president => president.office)
                        .select(president => ({
                            president: president,
                            names: president.user.successors(UserName, userName => userName.user)
                                .notExists(userName => userName.successors(UserName, next => next.prior))
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

    it("should parse select many using successors syntax", () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => ({
                    identifier: office.identifier,
                    presidents: office.successors(President, president => president.office)
                        .selectMany(president => president.user.predecessor()
                            .select(user => ({
                                user: user,
                                names: user.successors(UserName, userName => userName.user)
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

    it("should parse multiple givens using successors syntax", () => {
        const specification = model.given(Company, User).match((company, user) =>
            company.successors(President, president => president.office.company)
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

    it("should parse a predecessor join using predecessor syntax", () => {
        const specification = model.given(Office).match(office =>
            office.company.predecessor()
        );

        expectSpecification(specification, `
            (p1: Office) {
                u1: Company [
                    u1 = p1->company: Company
                ]
            } => u1`);
    });

    it("should parse a predecessor join with field projection using predecessor syntax", () => {
        const specification = model.given(Office).match(office =>
            office.company.predecessor()
                .select(company => company.identifier)
        );

        expectSpecification(specification, `
            (p1: Office) {
                u1: Company [
                    u1 = p1->company: Company
                ]
            } => u1.identifier`);
    });

    it("should parse a predecessor join with composite projection using predecessor syntax", () => {
        const specification = model.given(Office).match((office, facts) =>
            office.company.predecessor()
                .select(company => ({
                    identifier: company.identifier,
                    creator: facts.ofType(User)
                        .join(user => user, company.creator)
                }))
        );

        expectSpecification(specification, `
            (p1: Office) {
                u1: Company [
                    u1 = p1->company: Company
                ]
            } => {
                creator = {
                    u2: User [
                        u2 = u1->creator: User
                    ]
                } => u2
                identifier = u1.identifier
            }`);
    });

    it("should parse chained predecessor joins using predecessor syntax", () => {
        const specification = model.given(President).match(president =>
            president.office.predecessor()
                .selectMany(office => office.company.predecessor())
        );

        expectSpecification(specification, `
            (p1: President) {
                u1: Office [
                    u1 = p1->office: Office
                ]
                u2: Company [
                    u2 = u1->company: Company
                ]
            } => u2`);
    });

    it("should parse a predecessor join with existential condition using predecessor syntax", () => {
        const specification = model.given(OfficeClosed).match(officeClosed =>
            officeClosed.office.predecessor()
                .exists(office => office.company.predecessor())
        );

        expectSpecification(specification, `
            (p1: Office.Closed) {
                u1: Office [
                    u1 = p1->office: Office
                    E {
                        u2: Company [
                            u2 = u1->company: Company
                        ]
                    }
                ]
            } => u1`);
    });

    it("should parse existential condition on given (negative)", () => {
        // This test would require parsing syntax like:
        // (office: Office [!E { closure: Office.Closed [closure->office: Office = office] }])
        // For now, let's test by manually constructing the specification
        const specification: SpecificationOf<[Office], Office> = new SpecificationOf({
            given: [{
                label: {
                    name: "p1",
                    type: "Office"
                },
                conditions: [{
                    type: "existential",
                    exists: false,
                    matches: [{
                        unknown: {
                            name: "u1",
                            type: "Office.Closed"
                        },
                        conditions: [{
                            type: "path",
                            rolesLeft: [],
                            labelRight: "p1",
                            rolesRight: [{
                                name: "office",
                                predecessorType: "Office"
                            }]
                        }]
                    }]
                }]
            }],
            matches: [],
            projection: {
                type: "fact",
                label: "p1"
            }
        });

        expectSpecification(specification, `
            (p1: Office [
                    !E {
                        u1: Office.Closed [
                            u1 = p1->office: Office
                        ]
                    }
                ]) {
            } => p1`);
    });

    it("should parse existential condition on given (positive)", () => {
        // Similar to above but with positive existential condition
        const specification: SpecificationOf<[Office], Office> = new SpecificationOf({
            given: [{
                label: {
                    name: "p1",
                    type: "Office"
                },
                conditions: [{
                    type: "existential",
                    exists: true,
                    matches: [{
                        unknown: {
                            name: "u1",
                            type: "Office.Closed"
                        },
                        conditions: [{
                            type: "path",
                            rolesLeft: [],
                            labelRight: "p1", 
                            rolesRight: [{
                                name: "office",
                                predecessorType: "Office"
                            }]
                        }]
                    }]
                }]
            }],
            matches: [],
            projection: {
                type: "fact",
                label: "p1"
            }
        });

        expectSpecification(specification, `
            (p1: Office [
                    E {
                        u1: Office.Closed [
                            u1 = p1->office: Office
                        ]
                    }
                ]) {
            } => p1`);
    });
});

function expectSpecification<T, U>(specification: SpecificationOf<T, U>, expected: string) {
    expect("\n" + specification.toDescriptiveString(3)).toBe(expected + "\n");
}
