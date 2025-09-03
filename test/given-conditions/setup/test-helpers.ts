import { JinagaTest } from "@src";
import { Administrator, Company, Employee, Manager, Office, OfficeClosed, OfficeReopened, User } from "../../companyModel";
import { TestData } from "./test-data-factories";


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
