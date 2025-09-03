import { Jinaga, JinagaTest } from "@src";
import { Administrator, Company, Employee, Manager, Office, OfficeClosed, OfficeReopened, User } from "../../companyModel";

export interface TestData {
  jinaga: Jinaga;
  users: User[];
  companies: Company[];
  offices: Office[];
  closures: OfficeClosed[];
  reopenings: OfficeReopened[];
  administrators: Administrator[];
  managers: Manager[];
  employees: Employee[];
}

/**
 * Creates a complex multi-company scenario with various relationships
 */
export async function createComplexCompanyScenario(): Promise<TestData> {
  const creator = new User("creator-public-key");
  const user2 = new User("user2-public-key");
  const user3 = new User("user3-public-key");

  // Multiple companies
  const companies = [
    new Company(creator, "TechCorp"),
    new Company(user2, "DataSys"),
    new Company(user3, "InnovateInc")
  ];

  // Offices for each company
  const offices = [
    // TechCorp offices
    new Office(companies[0], "Headquarters"),
    new Office(companies[0], "Branch Office A"),
    new Office(companies[0], "Branch Office B"),

    // DataSys offices
    new Office(companies[1], "Main Office"),
    new Office(companies[1], "Remote Office"),

    // InnovateInc offices
    new Office(companies[2], "Innovation Hub")
  ];

  // Various closures and reopenings
  const closures = [
    new OfficeClosed(offices[1], new Date("2023-03-01")), // Branch Office A closed
    new OfficeClosed(offices[2], new Date("2023-05-01")), // Branch Office B closed
    new OfficeClosed(offices[4], new Date("2023-07-01"))  // Remote Office closed
  ];

  const reopenings = [
    new OfficeReopened(closures[0]), // Branch Office A reopened
    new OfficeReopened(closures[1])  // Branch Office B reopened
  ];

  // Administrators, managers, employees
  const administrators = [
    new Administrator(companies[0], creator, new Date("2023-01-01")),
    new Administrator(companies[1], user2, new Date("2023-02-01")),
    new Administrator(companies[2], user3, new Date("2023-03-01"))
  ];

  const managers = [
    new Manager(offices[0], 2001), // TechCorp HQ
    new Manager(offices[3], 2002), // DataSys Main
    new Manager(offices[5], 2003)  // InnovateInc Hub
  ];

  const employees = [
    new Employee(offices[0], user2),
    new Employee(offices[0], user3),
    new Employee(offices[3], creator),
    new Employee(offices[5], user2)
  ];

  const jinaga = JinagaTest.create({
    initialState: [
      creator, user2, user3,
      ...companies,
      ...offices,
      ...closures,
      ...reopenings,
      ...administrators,
      ...managers,
      ...employees
    ]
  });

  return {
    jinaga,
    users: [creator, user2, user3],
    companies,
    offices,
    closures,
    reopenings,
    administrators,
    managers,
    employees
  };
}