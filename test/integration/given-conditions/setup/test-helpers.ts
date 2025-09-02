import { Jinaga, JinagaTest } from "../../../../src";
import { User, Company, Office, OfficeClosed, OfficeReopened, Administrator, Manager, Employee } from "../../../companyModel";

/**
 * Test helper utilities for given conditions integration tests
 */

export interface TestScenario {
  name: string;
  description: string;
  setup: () => Promise<TestData>;
  expectedResults: any[];
}

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
 * Creates a basic company-office scenario for testing
 */
export async function createBasicCompanyScenario(): Promise<TestData> {
  const creator = new User("creator-public-key");
  const user2 = new User("user2-public-key");

  const company1 = new Company(creator, "ACME Corp");
  const company2 = new Company(creator, "Globex Inc");

  const office1 = new Office(company1, "New York Office");
  const office2 = new Office(company1, "Los Angeles Office");
  const office3 = new Office(company2, "Chicago Office");

  // Create some closures and reopenings
  const closure1 = new OfficeClosed(office2, new Date("2023-06-01"));
  const reopening1 = new OfficeReopened(closure1);

  // Create administrators and other roles
  const admin1 = new Administrator(company1, creator, new Date("2023-01-01"));
  const manager1 = new Manager(office1, 1001);
  const employee1 = new Employee(office1, user2);

  const jinaga = JinagaTest.create({
    initialState: [
      creator,
      user2,
      company1,
      company2,
      office1,
      office2,
      office3,
      closure1,
      reopening1,
      admin1,
      manager1,
      employee1
    ]
  });

  return {
    jinaga,
    users: [creator, user2],
    companies: [company1, company2],
    offices: [office1, office2, office3],
    closures: [closure1],
    reopenings: [reopening1],
    administrators: [admin1],
    managers: [manager1],
    employees: [employee1]
  };
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

/**
 * Utility to create specifications with given conditions
 * This is a temporary helper until the model builder API supports given conditions
 */
export function createSpecificationWithGivenConditions(given: any[], matches: any[] = [], projection: any = null): any {
  return {
    given,
    matches,
    projection: projection || { type: "fact", label: "result" }
  };
}

/**
 * Helper to create existential conditions for given clauses
 */
export function createExistentialCondition(exists: boolean, matches: any[]): any {
  return {
    type: "existential",
    exists,
    matches
  };
}

/**
 * Helper to create path conditions
 */
export function createPathCondition(labelRight: string, rolesRight: any[] = []): any {
  return {
    type: "path",
    rolesLeft: [],
    labelRight,
    rolesRight
  };
}

/**
 * Helper to create match specifications
 */
export function createMatch(unknown: any, conditions: any[]): any {
  return {
    unknown,
    conditions
  };
}

/**
 * Asserts that results match expected facts by hash
 */
export function assertResultsMatchByHash(results: any[], expectedFacts: any[], jinaga: Jinaga): void {
  const resultHashes = results.map(result => jinaga.hash(result));
  const expectedHashes = expectedFacts.map(fact => jinaga.hash(fact));

  expect(resultHashes.sort()).toEqual(expectedHashes.sort());
}

/**
 * Asserts that results contain specific facts
 */
export function assertResultsContain(results: any[], expectedFacts: any[], jinaga: Jinaga): void {
  const resultHashes = results.map(result => jinaga.hash(result));
  const expectedHashes = expectedFacts.map(fact => jinaga.hash(fact));

  expectedHashes.forEach(expectedHash => {
    expect(resultHashes).toContain(expectedHash);
  });
}

/**
 * Asserts that results do not contain specific facts
 */
export function assertResultsDoNotContain(results: any[], excludedFacts: any[], jinaga: Jinaga): void {
  const resultHashes = results.map(result => jinaga.hash(result));
  const excludedHashes = excludedFacts.map(fact => jinaga.hash(fact));

  excludedHashes.forEach(excludedHash => {
    expect(resultHashes).not.toContain(excludedHash);
  });
}