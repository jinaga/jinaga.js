import { Model, SpecificationOf } from "../../src/specification/given";

class User {
    static Type = "User" as const;
    type = User.Type;
    constructor(
        public publicKey: string
    ) {}
}

class UserName {
    static Type = "User.Name" as const;
    type = UserName.Type;
    constructor(
        public user: User,
        public value: string,
        public prior: UserName[]
    ) {}
}

class Company {
    static Type = "Company" as const;
    type = Company.Type;
    constructor(
        public creator: User,
        public identifier: string
    ) {}
}

class Office {
    static Type = "Office" as const;
    type = Office.Type;
    constructor(
        public company: Company,
        public identifier: string
    ) {}
}

class OfficeClosed {
    static Type = "Office.Closed" as const;
    type = OfficeClosed.Type;
    constructor(
        public office: Office,
        public date: Date | string
    ) {}
}

class OfficeReopened {
    static Type = "Office.Reopened" as const;
    type = OfficeReopened.Type;
    constructor(
        public officeClosed: OfficeClosed
    ) {}
}

class President {
    static Type = "President" as const;
    type = President.Type;
    constructor(
        public office: Office,
        public user: User
    ) {}
}

const model = new Model()
    .type(User)
    .type(UserName, f => f
        .predecessor("user", User)
        .predecessor("prior", UserName)
    )
    .type(Company, f => f
        .predecessor("creator", User)
    )
    .type(Office, f => f
        .predecessor("company", Company)
    )
    .type(OfficeClosed, f => f
        .predecessor("office", Office)
    )
    .type(OfficeReopened, f => f
        .predecessor("officeClosed", OfficeClosed)
    )
    .type(President, f => f
        .predecessor("office", Office)
        .predecessor("user", User)
    );

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
            }`);
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
            }`);
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
            }`);
    });

    it("should parse nested negative existential condition", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office => facts.ofType(OfficeClosed)
                    .join(officeClosed => officeClosed.office, office)
                    .notExists(officeClosed => facts.ofType(OfficeReopened)
                        .join(officeReopened => officeReopened.officeClosed, officeClosed)
                    )
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
            }`);
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
                }
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
});

function expectSpecification<T>(specification: SpecificationOf<T>, expected: string) {
    expect("\n" + specification.toDescriptiveString(3)).toBe(expected + "\n");
}
