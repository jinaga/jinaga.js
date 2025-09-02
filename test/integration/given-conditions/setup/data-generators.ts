import { User, Company, Office, OfficeClosed, OfficeReopened, Administrator, Manager, Employee } from "../../../companyModel";

/**
 * Data generators for creating realistic test scenarios
 */

export interface GeneratedData {
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
 * Generates a small company network for basic testing
 */
export function generateSmallCompanyNetwork(): GeneratedData {
  const users = [
    new User("user-1-public-key"),
    new User("user-2-public-key")
  ];

  const companies = [
    new Company(users[0], "TestCorp")
  ];

  const offices = [
    new Office(companies[0], "Main Office"),
    new Office(companies[0], "Branch Office"),
    new Office(companies[0], "Remote Office")
  ];

  const closures = [
    new OfficeClosed(offices[1], new Date("2023-06-01"))
  ];

  const reopenings = [
    new OfficeReopened(closures[0])
  ];

  const administrators = [
    new Administrator(companies[0], users[0], new Date("2023-01-01"))
  ];

  const managers = [
    new Manager(offices[0], 1001),
    new Manager(offices[2], 1002)
  ];

  const employees = [
    new Employee(offices[0], users[1]),
    new Employee(offices[2], users[0])
  ];

  return {
    users,
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
 * Generates a medium-sized company network with more complexity
 */
export function generateMediumCompanyNetwork(): GeneratedData {
  const users = [
    new User("creator-public-key"),
    new User("admin-public-key"),
    new User("manager-public-key"),
    new User("employee-public-key")
  ];

  const companies = [
    new Company(users[0], "TechSolutions Inc"),
    new Company(users[1], "DataCorp")
  ];

  const offices = [
    // TechSolutions offices
    new Office(companies[0], "Headquarters"),
    new Office(companies[0], "East Branch"),
    new Office(companies[0], "West Branch"),

    // DataCorp offices
    new Office(companies[1], "Main Campus"),
    new Office(companies[1], "Satellite Office")
  ];

  const closures = [
    new OfficeClosed(offices[1], new Date("2023-03-01")), // East Branch closed
    new OfficeClosed(offices[2], new Date("2023-05-01")), // West Branch closed
    new OfficeClosed(offices[4], new Date("2023-07-01"))  // Satellite Office closed
  ];

  const reopenings = [
    new OfficeReopened(closures[0]), // East Branch reopened
    new OfficeReopened(closures[1])  // West Branch reopened
  ];

  const administrators = [
    new Administrator(companies[0], users[0], new Date("2023-01-01")),
    new Administrator(companies[1], users[1], new Date("2023-02-01"))
  ];

  const managers = [
    new Manager(offices[0], 2001), // TechSolutions HQ
    new Manager(offices[3], 2002), // DataCorp Main
    new Manager(offices[4], 2003)  // DataCorp Satellite (will be closed)
  ];

  const employees = [
    new Employee(offices[0], users[2]),
    new Employee(offices[0], users[3]),
    new Employee(offices[3], users[0]),
    new Employee(offices[3], users[2])
  ];

  return {
    users,
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
 * Generates a large company network for performance testing
 */
export function generateLargeCompanyNetwork(): GeneratedData {
  const users: User[] = [];
  const companies: Company[] = [];
  const offices: Office[] = [];
  const closures: OfficeClosed[] = [];
  const reopenings: OfficeReopened[] = [];
  const administrators: Administrator[] = [];
  const managers: Manager[] = [];
  const employees: Employee[] = [];

  // Generate users
  for (let i = 0; i < 20; i++) {
    users.push(new User(`user-${i}-public-key`));
  }

  // Generate companies
  for (let i = 0; i < 5; i++) {
    companies.push(new Company(users[i], `Company-${i}`));
  }

  // Generate offices (4 per company = 20 total)
  companies.forEach((company, companyIndex) => {
    for (let i = 0; i < 4; i++) {
      offices.push(new Office(company, `Office-${companyIndex}-${i}`));
    }
  });

  // Generate closures (close 30% of offices)
  offices.forEach((office, index) => {
    if (index % 3 === 0) { // Every 3rd office is closed
      closures.push(new OfficeClosed(office, new Date(`2023-${String(index % 12 + 1).padStart(2, '0')}-01`)));
    }
  });

  // Generate reopenings (reopen 50% of closed offices)
  closures.forEach((closure, index) => {
    if (index % 2 === 0) { // Every 2nd closure is reopened
      reopenings.push(new OfficeReopened(closure));
    }
  });

  // Generate administrators (1 per company)
  companies.forEach((company, index) => {
    administrators.push(new Administrator(company, users[index], new Date("2023-01-01")));
  });

  // Generate managers (1 per office)
  offices.forEach((office, index) => {
    managers.push(new Manager(office, 3000 + index));
  });

  // Generate employees (distributed across offices)
  offices.forEach((office, officeIndex) => {
    const employeeCount = Math.floor(Math.random() * 3) + 1; // 1-3 employees per office
    for (let i = 0; i < employeeCount; i++) {
      const userIndex = (officeIndex + i) % users.length;
      employees.push(new Employee(office, users[userIndex]));
    }
  });

  return {
    users,
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
 * Injects edge cases into existing data
 */
export function injectEdgeCases(data: GeneratedData): GeneratedData {
  // Add circular references, orphaned facts, etc.
  // This is a placeholder for future edge case injection
  return data;
}

/**
 * Creates a deterministic seed for reproducible test data
 */
export function createDeterministicSeed(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return () => {
    hash = Math.sin(hash) * 10000;
    return hash - Math.floor(hash);
  };
}

/**
 * Generates data with specific patterns for testing
 */
export interface DataPattern {
  name: string;
  description: string;
  generator: () => GeneratedData;
}

export const dataPatterns: DataPattern[] = [
  {
    name: "small-network",
    description: "Basic company with 3 offices, 1 closure",
    generator: generateSmallCompanyNetwork
  },
  {
    name: "medium-network",
    description: "Two companies with 5 offices, multiple closures",
    generator: generateMediumCompanyNetwork
  },
  {
    name: "large-network",
    description: "5 companies with 20 offices for performance testing",
    generator: generateLargeCompanyNetwork
  }
];

/**
 * Gets a data pattern by name
 */
export function getDataPattern(name: string): DataPattern | undefined {
  return dataPatterns.find(pattern => pattern.name === name);
}

/**
 * Lists all available data patterns
 */
export function listDataPatterns(): string[] {
  return dataPatterns.map(pattern => pattern.name);
}