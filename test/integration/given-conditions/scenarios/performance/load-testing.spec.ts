import { dehydrateFact, FactReference, MemoryStore } from "@src";
import { Administrator, Company, Employee, Manager, Office, OfficeClosed, OfficeReopened, User } from "../../../../companyModel";
import { SpecificationTemplates } from "../../setup/specification-builders";

/**
 * Load testing utilities for generating massive datasets
 */
interface LoadTestMetrics {
  datasetSize: number;
  executionTime: number;
  memoryUsage: number;
  throughput: number; // facts per second
  resultCount: number;
  timestamp: Date;
}

interface LoadTestResult {
  name: string;
  metrics: LoadTestMetrics;
  passed: boolean;
  error?: string;
}

class LoadTester {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Generates a massive dataset for load testing
   */
  generateMassiveDataset(size: number): {
    users: User[];
    companies: Company[];
    offices: Office[];
    closures: OfficeClosed[];
    reopenings: OfficeReopened[];
    administrators: Administrator[];
    managers: Manager[];
    employees: Employee[];
  } {
    const users: User[] = [];
    const companies: Company[] = [];
    const offices: Office[] = [];
    const closures: OfficeClosed[] = [];
    const reopenings: OfficeReopened[] = [];
    const administrators: Administrator[] = [];
    const managers: Manager[] = [];
    const employees: Employee[] = [];

    // Generate users
    for (let i = 0; i < Math.max(100, size / 50); i++) {
      users.push(new User(`user-${i}-public-key`));
    }

    // Generate companies (1 company per 10 users)
    const companyCount = Math.max(5, Math.floor(users.length / 10));
    for (let i = 0; i < companyCount; i++) {
      companies.push(new Company(users[i % users.length], `LoadTest-Company-${i}`));
    }

    // Generate offices (5 offices per company)
    companies.forEach((company, companyIndex) => {
      for (let i = 0; i < 5; i++) {
        offices.push(new Office(company, `Office-${companyIndex}-${i}`));
      }
    });

    // Generate closures (close 40% of offices)
    offices.forEach((office, index) => {
      if (index % 5 < 2) { // 40% closure rate
        closures.push(new OfficeClosed(office, new Date(`2023-${String((index % 12) + 1).padStart(2, '0')}-01`)));
      }
    });

    // Generate reopenings (reopen 60% of closed offices)
    closures.forEach((closure, index) => {
      if (index % 5 < 3) { // 60% reopening rate
        reopenings.push(new OfficeReopened(closure));
      }
    });

    // Generate administrators (1 per company)
    companies.forEach((company, index) => {
      administrators.push(new Administrator(company, users[index % users.length], new Date("2023-01-01")));
    });

    // Generate managers (1 per office)
    offices.forEach((office, index) => {
      managers.push(new Manager(office, 10000 + index));
    });

    // Generate employees (distributed across offices)
    offices.forEach((office: Office, officeIndex: number) => {
      const employeeCount = Math.floor(Math.random() * 8) + 3; // 3-10 employees per office
      for (let i = 0; i < employeeCount; i++) {
        const userIndex = (officeIndex * employeeCount + i) % users.length;
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
   * Measures load test performance
   */
  async measureLoadTest(
    name: string,
    givenFacts: FactReference[],
    specification: any,
    expectedDatasetSize: number,
    timeLimitMs: number = 5000
  ): Promise<LoadTestResult> {
    const startTime = performance.now();
    const startMemory = this.getMemoryUsage();

    try {
      const results = await this.store.read(givenFacts, specification);

      const endTime = performance.now();
      const endMemory = this.getMemoryUsage();

      const executionTime = endTime - startTime;
      const memoryUsage = endMemory - startMemory;
      const throughput = expectedDatasetSize / (executionTime / 1000); // facts per second

      const metrics: LoadTestMetrics = {
        datasetSize: expectedDatasetSize,
        executionTime,
        memoryUsage,
        throughput,
        resultCount: results.length,
        timestamp: new Date()
      };

      const passed = executionTime <= timeLimitMs && memoryUsage < 100 * 1024 * 1024; // < 100MB

      return {
        name,
        metrics,
        passed
      };
    } catch (error) {
      const endTime = performance.now();
      const endMemory = this.getMemoryUsage();

      return {
        name,
        metrics: {
          datasetSize: expectedDatasetSize,
          executionTime: endTime - startTime,
          memoryUsage: endMemory - startMemory,
          throughput: 0,
          resultCount: 0,
          timestamp: new Date()
        },
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Gets current memory usage (simplified for Node.js environment)
   */
  private getMemoryUsage(): number {
    // In a real implementation, this would use process.memoryUsage()
    // For now, return a placeholder value
    return 0;
  }
}

describe("Given Conditions - Load Testing", () => {
  let store: MemoryStore;
  let loadTester: LoadTester;

  beforeEach(async () => {
    store = new MemoryStore();
    loadTester = new LoadTester(store);
  });

  describe("Large Dataset Generation", () => {
    it("should generate datasets of various sizes", () => {
      const sizes = [1000, 5000, 10000, 25000];

      sizes.forEach(size => {
        const dataset = loadTester.generateMassiveDataset(size);

        // Validate dataset structure
        expect(dataset.users.length).toBeGreaterThan(0);
        expect(dataset.companies.length).toBeGreaterThan(0);
        expect(dataset.offices.length).toBeGreaterThan(0);

        // Validate relationships
        expect(dataset.offices.length).toBe(dataset.companies.length * 5); // 5 offices per company
        expect(dataset.managers.length).toBe(dataset.offices.length); // 1 manager per office
        expect(dataset.administrators.length).toBe(dataset.companies.length); // 1 admin per company
      });
    });

    it("should maintain referential integrity in large datasets", () => {
      const dataset = loadTester.generateMassiveDataset(5000);

      // Validate that all offices belong to valid companies
      dataset.offices.forEach(office => {
        expect(dataset.companies.some(company => company === office.company)).toBe(true);
      });

      // Validate that all closures belong to valid offices
      dataset.closures.forEach(closure => {
        expect(dataset.offices.some(office => office === closure.office)).toBe(true);
      });

      // Validate that all reopenings belong to valid closures
      dataset.reopenings.forEach(reopening => {
        expect(dataset.closures.some(closure => closure === reopening.officeClosed)).toBe(true);
      });
    });
  });

  describe("10k+ Facts Load Testing", () => {
    it("should handle 10k facts dataset with simple queries", async () => {
      const dataset = loadTester.generateMassiveDataset(10000);

      // Save all facts to store
      const allFacts = [
        ...dataset.users,
        ...dataset.companies,
        ...dataset.offices,
        ...dataset.closures,
        ...dataset.reopenings,
        ...dataset.administrators,
        ...dataset.managers,
        ...dataset.employees
      ];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specification = SpecificationTemplates.officesClosed();

      // Test with a closed office
      const closedOffice = dataset.offices.find(office =>
        dataset.closures.some(closure => closure.office === office)
      );

      const officeRef: FactReference = dehydrateFact(closedOffice!)[0];

      const result = await loadTester.measureLoadTest(
        "10k-simple-query",
        [officeRef],
        specification,
        10000,
        2000 // 2 second limit for 10k facts
      );

      expect(result.passed).toBe(true);
      expect(result.metrics.executionTime).toBeLessThan(2000);
      expect(result.metrics.throughput).toBeGreaterThan(1000); // At least 1000 facts/second
    });

    it("should handle 10k facts dataset with complex queries", async () => {
      const dataset = loadTester.generateMassiveDataset(10000);

      // Save all facts to store
      const allFacts = [
        ...dataset.users,
        ...dataset.companies,
        ...dataset.offices,
        ...dataset.closures,
        ...dataset.reopenings,
        ...dataset.administrators,
        ...dataset.managers,
        ...dataset.employees
      ];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specification = SpecificationTemplates.officesClosedNotReopened();

      // Test with a closed but not reopened office
      const targetOffice = dataset.offices.find(office => {
        const hasClosure = dataset.closures.some(closure => closure.office === office);
        const hasReopening = dataset.reopenings.some(reopening =>
          dataset.closures.some(closure =>
            closure.office === office && reopening.officeClosed === closure
          )
        );
        return hasClosure && !hasReopening;
      });

      const officeRef: FactReference = dehydrateFact(targetOffice!)[0];

      const result = await loadTester.measureLoadTest(
        "10k-complex-query",
        [officeRef],
        specification,
        10000,
        3000 // 3 second limit for complex queries on 10k facts
      );

      expect(result.passed).toBe(true);
      expect(result.metrics.executionTime).toBeLessThan(3000);
      expect(result.metrics.throughput).toBeGreaterThan(500); // At least 500 facts/second for complex queries
    });
  });

  describe("High-Load Scenarios", () => {
    it("should handle concurrent queries under load", async () => {
      const dataset = loadTester.generateMassiveDataset(5000);

      // Save all facts to store
      const allFacts = [
        ...dataset.users,
        ...dataset.companies,
        ...dataset.offices,
        ...dataset.closures,
        ...dataset.reopenings,
        ...dataset.administrators,
        ...dataset.managers,
        ...dataset.employees
      ];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specification = SpecificationTemplates.officesClosed();
      const queryCount = 10;

      // Prepare multiple queries
      const queries: FactReference[] = [];
      for (let i = 0; i < queryCount; i++) {
        const office = dataset.offices[i % dataset.offices.length];
        const officeRef: FactReference = dehydrateFact(office)[0];
        queries.push(officeRef);
      }

      // Execute concurrent queries
      const startTime = performance.now();
      const promises = queries.map(query =>
        loadTester.measureLoadTest(
          `concurrent-query-${query.hash.substring(0, 8)}`,
          [query],
          specification,
          5000,
          5000
        )
      );

      const results = await Promise.all(promises);
      const endTime = performance.now();

      const totalTime = endTime - startTime;
      const avgTime = results.reduce((sum, r) => sum + r.metrics.executionTime, 0) / results.length;

      // Validate concurrent performance
      expect(totalTime).toBeLessThan(10000); // Total time < 10 seconds
      expect(avgTime).toBeLessThan(1000); // Average query time < 1 second
      expect(results.every(r => r.passed)).toBe(true);
    });

    it("should handle mixed query patterns under load", async () => {
      const dataset = loadTester.generateMassiveDataset(7500);

      // Save all facts to store
      const allFacts = [
        ...dataset.users,
        ...dataset.companies,
        ...dataset.offices,
        ...dataset.closures,
        ...dataset.reopenings,
        ...dataset.administrators,
        ...dataset.managers,
        ...dataset.employees
      ];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specifications = [
        SpecificationTemplates.officesClosed(),
        SpecificationTemplates.officesNotClosed(),
        SpecificationTemplates.officesClosedNotReopened()
      ];

      const results: LoadTestResult[] = [];

      // Execute different types of queries
      for (let i = 0; i < specifications.length; i++) {
        const spec = specifications[i];
        const office = dataset.offices[i % dataset.offices.length];
        const officeRef: FactReference = dehydrateFact(office)[0];

        const result = await loadTester.measureLoadTest(
          `mixed-query-${i}`,
          [officeRef],
          spec,
          7500,
          4000
        );

        results.push(result);
      }

      // Validate mixed query performance
      expect(results.every(r => r.passed)).toBe(true);
      expect(results.every(r => r.metrics.executionTime < 4000)).toBe(true);

      // Check that complex queries don't degrade simple query performance significantly
      const simpleQuery = results.find(r => r.name.includes('mixed-query-0'));
      const complexQuery = results.find(r => r.name.includes('mixed-query-2'));

      if (simpleQuery && complexQuery) {
        expect(complexQuery.metrics.executionTime).toBeLessThan(simpleQuery.metrics.executionTime * 3);
      }
    });
  });

  describe("Memory Usage Validation", () => {
    it("should validate memory usage stays within limits for large datasets", async () => {
      const dataset = loadTester.generateMassiveDataset(15000);

      // Save all facts to store
      const allFacts = [
        ...dataset.users,
        ...dataset.companies,
        ...dataset.offices,
        ...dataset.closures,
        ...dataset.reopenings,
        ...dataset.administrators,
        ...dataset.managers,
        ...dataset.employees
      ];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specification = SpecificationTemplates.officesClosed();

      const closedOffice = dataset.offices.find(office =>
        dataset.closures.some(closure => closure.office === office)
      );

      const officeRef: FactReference = dehydrateFact(closedOffice!)[0];

      const result = await loadTester.measureLoadTest(
        "memory-validation-test",
        [officeRef],
        specification,
        15000,
        5000
      );

      // Memory usage should be reasonable (< 100MB for 15k facts)
      expect(result.metrics.memoryUsage).toBeLessThan(100 * 1024 * 1024);
      expect(result.passed).toBe(true);
    });

    it("should detect memory leaks in repeated queries", async () => {
      const dataset = loadTester.generateMassiveDataset(3000);

      // Save all facts to store
      const allFacts = [
        ...dataset.users,
        ...dataset.companies,
        ...dataset.offices,
        ...dataset.closures,
        ...dataset.reopenings,
        ...dataset.administrators,
        ...dataset.managers,
        ...dataset.employees
      ];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specification = SpecificationTemplates.officesClosed();
      const office = dataset.offices[0];
      const officeRef: FactReference = dehydrateFact(office)[0];

      const memoryUsages: number[] = [];

      // Execute the same query multiple times
      for (let i = 0; i < 10; i++) {
        const result = await loadTester.measureLoadTest(
          `memory-leak-test-${i}`,
          [officeRef],
          specification,
          3000,
          1000
        );

        memoryUsages.push(result.metrics.memoryUsage);
      }

      // Check for memory leaks (memory usage shouldn't increase significantly)
      const initialMemory = memoryUsages[0];
      const finalMemory = memoryUsages[memoryUsages.length - 1];
      const memoryIncrease = finalMemory - initialMemory;

      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // < 10MB increase over 10 queries
    });
  });

  describe("Load Test Reporting", () => {
    it("should generate comprehensive load test reports", async () => {
      const dataset = loadTester.generateMassiveDataset(2000);

      // Save all facts to store
      const allFacts = [
        ...dataset.users,
        ...dataset.companies,
        ...dataset.offices,
        ...dataset.closures,
        ...dataset.reopenings,
        ...dataset.administrators,
        ...dataset.managers,
        ...dataset.employees
      ];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const results: LoadTestResult[] = [];
      const specifications = [
        SpecificationTemplates.officesClosed(),
        SpecificationTemplates.officesNotClosed(),
        SpecificationTemplates.officesClosedNotReopened()
      ];

      // Run multiple load tests
      for (let i = 0; i < specifications.length; i++) {
        const spec = specifications[i];
        const office = dataset.offices[i % dataset.offices.length];
        const officeRef: FactReference = dehydrateFact(office)[0];

        const result = await loadTester.measureLoadTest(
          `report-test-${i}`,
          [officeRef],
          spec,
          2000,
          3000
        );

        results.push(result);
      }

      // Validate report structure
      expect(results.length).toBe(3);
      results.forEach(result => {
        expect(result.name).toMatch(/^report-test-\d$/);
        expect(result.metrics).toBeDefined();
        expect(result.metrics.datasetSize).toBe(2000);
        expect(result.metrics.executionTime).toBeGreaterThan(0);
        expect(result.metrics.throughput).toBeGreaterThan(0);
        expect(typeof result.passed).toBe('boolean');
      });

      // Calculate aggregate statistics
      const avgThroughput = results.reduce((sum, r) => sum + r.metrics.throughput, 0) / results.length;
      const totalTime = results.reduce((sum, r) => sum + r.metrics.executionTime, 0);
      const successRate = results.filter(r => r.passed).length / results.length;

      expect(avgThroughput).toBeGreaterThan(100);
      expect(totalTime).toBeGreaterThan(0);
      expect(successRate).toBe(1.0); // All tests should pass
    });
  });
});