"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.model = exports.Employee = exports.ManagerTerminated = exports.ManagerName = exports.Manager = exports.President = exports.OfficeReopened = exports.OfficeClosed = exports.Office = exports.AdministratorRevoked = exports.Administrator = exports.Company = exports.UserName = void 0;
const _src_1 = require("@src");
class UserName {
    constructor(user, value, prior) {
        this.user = user;
        this.value = value;
        this.prior = prior;
        this.type = UserName.Type;
    }
}
exports.UserName = UserName;
UserName.Type = "User.Name";
class Company {
    constructor(creator, identifier) {
        this.creator = creator;
        this.identifier = identifier;
        this.type = Company.Type;
    }
}
exports.Company = Company;
Company.Type = "Company";
class Administrator {
    constructor(company, user, date) {
        this.company = company;
        this.user = user;
        this.date = date;
        this.type = Administrator.Type;
    }
}
exports.Administrator = Administrator;
Administrator.Type = "Administrator";
class AdministratorRevoked {
    constructor(administrator) {
        this.administrator = administrator;
        this.type = AdministratorRevoked.Type;
    }
}
exports.AdministratorRevoked = AdministratorRevoked;
AdministratorRevoked.Type = "Administrator.Revoked";
class Office {
    constructor(company, identifier) {
        this.company = company;
        this.identifier = identifier;
        this.type = Office.Type;
    }
    static inCompany(facts, company) {
        return facts.ofType(Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(OfficeClosed)
            .join(officeClosed => officeClosed.office, office)
            .notExists(officeClosed => facts.ofType(OfficeReopened)
            .join(officeReopened => officeReopened.officeClosed, officeClosed)));
    }
}
exports.Office = Office;
Office.Type = "Office";
class OfficeClosed {
    constructor(office, date) {
        this.office = office;
        this.date = date;
        this.type = OfficeClosed.Type;
    }
}
exports.OfficeClosed = OfficeClosed;
OfficeClosed.Type = "Office.Closed";
class OfficeReopened {
    constructor(officeClosed) {
        this.officeClosed = officeClosed;
        this.type = OfficeReopened.Type;
    }
}
exports.OfficeReopened = OfficeReopened;
OfficeReopened.Type = "Office.Reopened";
class President {
    constructor(office, user) {
        this.office = office;
        this.user = user;
        this.type = President.Type;
    }
}
exports.President = President;
President.Type = "President";
class Manager {
    constructor(office, employeeNumber) {
        this.office = office;
        this.employeeNumber = employeeNumber;
        this.type = Manager.Type;
    }
}
exports.Manager = Manager;
Manager.Type = "Manager";
class ManagerName {
    constructor(manager, value, prior) {
        this.manager = manager;
        this.value = value;
        this.prior = prior;
        this.type = ManagerName.Type;
    }
}
exports.ManagerName = ManagerName;
ManagerName.Type = "Manager.Name";
class ManagerTerminated {
    constructor(manager, date) {
        this.manager = manager;
        this.date = date;
        this.type = ManagerTerminated.Type;
    }
}
exports.ManagerTerminated = ManagerTerminated;
ManagerTerminated.Type = "Manager.Terminated";
class Employee {
    constructor(office, user) {
        this.office = office;
        this.user = user;
        this.type = Employee.Type;
    }
}
exports.Employee = Employee;
Employee.Type = "Employee";
const officeFacts = (m) => m
    .type(_src_1.User)
    .type(UserName, f => f
    .predecessor("user", _src_1.User)
    .predecessor("prior", UserName))
    .type(Company, f => f
    .predecessor("creator", _src_1.User))
    .type(Administrator, f => f
    .predecessor("company", Company)
    .predecessor("user", _src_1.User))
    .type(AdministratorRevoked, f => f
    .predecessor("administrator", Administrator))
    .type(Office, f => f
    .predecessor("company", Company))
    .type(OfficeClosed, f => f
    .predecessor("office", Office))
    .type(OfficeReopened, f => f
    .predecessor("officeClosed", OfficeClosed))
    .type(President, f => f
    .predecessor("office", Office)
    .predecessor("user", _src_1.User))
    .type(Manager, f => f
    .predecessor("office", Office))
    .type(ManagerName, f => f
    .predecessor("manager", Manager)
    .predecessor("prior", ManagerName))
    .type(ManagerTerminated, f => f
    .predecessor("manager", Manager))
    .type(Employee, f => f
    .predecessor("office", Office)
    .predecessor("user", _src_1.User));
exports.model = (0, _src_1.buildModel)(officeFacts);
//# sourceMappingURL=companyModel.js.map