import { FactRepository, LabelOf, User } from "@src";
export declare class UserName {
    user: User;
    value: string;
    prior: UserName[];
    static Type: "User.Name";
    type: "User.Name";
    constructor(user: User, value: string, prior: UserName[]);
}
export declare class Company {
    creator: User;
    identifier: string;
    static Type: "Company";
    type: "Company";
    constructor(creator: User, identifier: string);
}
export declare class Administrator {
    company: Company;
    user: User;
    date: Date | string;
    static Type: "Administrator";
    type: "Administrator";
    constructor(company: Company, user: User, date: Date | string);
}
export declare class AdministratorRevoked {
    administrator: Administrator;
    static Type: "Administrator.Revoked";
    type: "Administrator.Revoked";
    constructor(administrator: Administrator);
}
export declare class Office {
    company: Company;
    identifier: string;
    static Type: "Office";
    type: "Office";
    constructor(company: Company, identifier: string);
    static inCompany(facts: FactRepository, company: LabelOf<Company>): import("../src/specification/model").Traversal<LabelOf<Office>>;
}
export declare class OfficeClosed {
    office: Office;
    date: Date | string;
    static Type: "Office.Closed";
    type: "Office.Closed";
    constructor(office: Office, date: Date | string);
}
export declare class OfficeReopened {
    officeClosed: OfficeClosed;
    static Type: "Office.Reopened";
    type: "Office.Reopened";
    constructor(officeClosed: OfficeClosed);
}
export declare class President {
    office: Office;
    user: User;
    static Type: "President";
    type: "President";
    constructor(office: Office, user: User);
}
export declare class Manager {
    office: Office;
    employeeNumber: number;
    static Type: "Manager";
    type: "Manager";
    constructor(office: Office, employeeNumber: number);
}
export declare class ManagerName {
    manager: Manager;
    value: string;
    prior: ManagerName[];
    static Type: "Manager.Name";
    type: "Manager.Name";
    constructor(manager: Manager, value: string, prior: ManagerName[]);
}
export declare class ManagerTerminated {
    manager: Manager;
    date: Date | string;
    static Type: "Manager.Terminated";
    type: "Manager.Terminated";
    constructor(manager: Manager, date: Date | string);
}
export declare class Employee {
    office: Office;
    user: User;
    static Type: "Employee";
    type: "Employee";
    constructor(office: Office, user: User);
}
export declare const model: import("@src").Model;
//# sourceMappingURL=companyModel.d.ts.map