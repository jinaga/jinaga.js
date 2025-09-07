import { buildModel, FactRepository, LabelOf, ModelBuilder, User } from "@src";

export class UserName {
    static Type = "User.Name" as const;
    type = UserName.Type;
    constructor(
        public user: User,
        public value: string,
        public prior: UserName[]
    ) { }
}

export class Company {
    static Type = "Company" as const;
    type = Company.Type;
    constructor(
        public creator: User,
        public identifier: string
    ) { }
}

export class Administrator {
    static Type = "Administrator" as const;
    type = Administrator.Type;
    constructor(
        public company: Company,
        public user: User,
        public date: Date | string
    ) { }
}

export class AdministratorRevoked {
    static Type = "Administrator.Revoked" as const;
    type = AdministratorRevoked.Type;
    constructor(
        public administrator: Administrator
    ) { }
}

export class Office {
    static Type = "Office" as const;
    type = Office.Type;
    constructor(
        public company: Company,
        public identifier: string
    ) { }

    static inCompany(facts: FactRepository, company: LabelOf<Company>) {
        return facts.ofType(Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(OfficeClosed)
                .join(officeClosed => officeClosed.office, office)
                .notExists(officeClosed => facts.ofType(OfficeReopened)
                    .join(officeReopened => officeReopened.officeClosed, officeClosed)
                )
            );
    }
}

export class OfficeClosed {
    static Type = "Office.Closed" as const;
    type = OfficeClosed.Type;
    constructor(
        public office: Office,
        public date: Date | string
    ) { }
}

export class OfficeReopened {
    static Type = "Office.Reopened" as const;
    type = OfficeReopened.Type;
    constructor(
        public officeClosed: OfficeClosed
    ) { }
}

export class President {
    static Type = "President" as const;
    type = President.Type;
    constructor(
        public office: Office,
        public user: User
    ) { }
}

export class Manager {
    static Type = "Manager" as const;
    type = Manager.Type;
    constructor(
        public office: Office,
        public employeeNumber: number
    ) { }
}

export class ManagerName {
    static Type = "Manager.Name" as const;
    type = ManagerName.Type;
    constructor(
        public manager: Manager,
        public value: string,
        public prior: ManagerName[]
    ) { }
}

export class ManagerTerminated {
    static Type = "Manager.Terminated" as const;
    type = ManagerTerminated.Type;
    constructor(
        public manager: Manager,
        public date: Date | string
    ) { }
}

export class Employee {
    static Type = "Employee" as const;
    type = Employee.Type;
    constructor(
        public office: Office,
        public user: User
    ) { }
}

const officeFacts = (m: ModelBuilder) => m
    .type(User)
    .type(UserName, f => f
        .predecessor("user", User)
        .predecessor("prior", UserName)
    )
    .type(Company, f => f
        .predecessor("creator", User)
    )
    .type(Administrator, f => f
        .predecessor("company", Company)
        .predecessor("user", User)
    )
    .type(AdministratorRevoked, f => f
        .predecessor("administrator", Administrator)
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
    )
    .type(Manager, f => f
        .predecessor("office", Office)
    )
    .type(ManagerName, f => f
        .predecessor("manager", Manager)
        .predecessor("prior", ManagerName)
    )
    .type(ManagerTerminated, f => f
        .predecessor("manager", Manager)
    )
    .type(Employee, f => f
        .predecessor("office", Office)
        .predecessor("user", User)
    );

export const model = buildModel(officeFacts);
