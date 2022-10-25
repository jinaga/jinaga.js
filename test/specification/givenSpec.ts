import { given } from "../../src/specification/given"

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
        public value: string
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

class President {
    static Type = "President" as const;
    type = President.Type;
    constructor(
        public office: Office,
        public user: User
    ) {}
}

describe("given", () => {
    it("should return a specification", () => {
        const offices = given(Company).match((company, facts) => {
            const office = facts.ofType(Office)
                .join(office => office.predecessor("company", Company), company);

            return {
                identifier: office.field("identifier"),
                presidents: facts.observable(() => {
                    const president = facts.ofType(President)
                        .join(president => president.predecessor("office", Office), office);

                    return {
                        user: president.predecessor("user", User).fact(),
                        names: facts.observable(() => facts.ofType(UserName)
                            .join(userName => userName.predecessor("user", User), president.predecessor("user", User))
                            .field("value")
                        )
                    };
                })
            }
        });

        expect(offices).toBeDefined();
    });
});