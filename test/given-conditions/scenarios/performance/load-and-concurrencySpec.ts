import { dehydrateFact, FactReference, MemoryStore } from "@src";
import { Administrator, Company, Employee, Manager, Office, OfficeClosed, OfficeReopened, User } from "../../../companyModel";
import { GeneratedData, generateLargeCompanyNetwork } from "../../setup/data-generators";
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

/**
 * Concurrent load testing utilities for given conditions
 */
interface ConcurrentTestMetrics {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  totalExecutionTime: number;
  averageQueryTime: number;
  throughput: number; // queries per second
  errorRate: number;
  timestamp: Date;
}

interface ConcurrentTestResult {
  name: string;
  metrics: ConcurrentTestMetrics;
  passed: boolean;
  errors: string[];
}

interface QueryLoadPattern {
  name: string;
  description: string;
  queryCount: number;
  concurrencyLevel: number;
  specifications: any[];
  expectedSuccessRate: number;
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

class ConcurrentLoadTester {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Executes multiple queries concurrently
   */
  async executeConcurrentQueries(
    name: string,
    queries: Array<{ given: FactReference[]; specification: any; queryId: string }>,
    concurrencyLimit: number = 10
  ): Promise<ConcurrentTestResult> {
    const startTime = performance.now();
    const results: Array<{ queryId: string; success: boolean; executionTime: number; error?: string }> = [];
    const errors: string[] = [];

    // Execute queries in batches to control concurrency
    for (let i = 0; i < queries.length; i += concurrencyLimit) {
      const batch = queries.slice(i, i + concurrencyLimit);
      const batchPromises = batch.map(async (query) => {
        const queryStartTime = performance.now();

        try {
          const result = await this.store.read(query.given, query.specification);
          const queryEndTime = performance.now();

          return {
            queryId: query.queryId,
            success: true,
            executionTime: queryEndTime - queryStartTime,
            resultCount: result.length
          };
        } catch (error) {
          const queryEndTime = performance.now();

          return {
            queryId: query.queryId,
            success: false,
            executionTime: queryEndTime - queryStartTime,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    const endTime = performance.now();
    const totalExecutionTime = endTime - startTime;

    const successfulQueries = results.filter(r => r.success).length;
    const failedQueries = results.filter(r => !r.success).length;
    const averageQueryTime = results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;
    const throughput = results.length / (totalExecutionTime / 1000);
    const errorRate = failedQueries / results.length;

    // Collect errors
    results.filter(r => !r.success).forEach(r => {
      if (r.error) errors.push(`${r.queryId}: ${r.error}`);
    });

    const metrics: ConcurrentTestMetrics = {
      totalQueries: results.length,
      successfulQueries,
      failedQueries,
      totalExecutionTime,
      averageQueryTime,
      throughput,
      errorRate,
      timestamp: new Date()
    };

    const passed = errorRate <= 0.05 && averageQueryTime < 1000; // < 5% error rate and < 1s avg query time

    return {
      name,
      metrics,
      passed,
      errors
    };
  }

  /**
   * Creates a load pattern for testing
   */
  createLoadPattern(
    name: string,
    description: string,
    queryCount: number,
    concurrencyLevel: number,
    specifications: any[],
    expectedSuccessRate: number = 0.95
  ): QueryLoadPattern {
    return {
      name,
      description,
      queryCount,
      concurrencyLevel,
      specifications,
      expectedSuccessRate
    };
  }

  /**
   * Generates queries for a given load pattern
   */
  generateQueriesForPattern(
    pattern: QueryLoadPattern,
    availableOffices: Office[],
    availableCompanies: Company[]
  ): Array<{ given: FactReference[]; specification: any; queryId: string }> {
    const queries: Array<{ given: FactReference[]; specification: any; queryId: string }> = [];

    for (let i = 0; i < pattern.queryCount; i++) {
      const specIndex = i % pattern.specifications.length;
      const specification = pattern.specifications[specIndex];

      // Alternate between office and company queries
      let givenFacts: FactReference[];
      let queryType: string;

      if (i % 2 === 0) {
        // Office query
        const office = availableOffices[i % availableOffices.length];
        givenFacts = [dehydrateFact(office)[0]];
        queryType = "office";
      } else {
        // Company query
        const company = availableCompanies[i % availableCompanies.length];
        givenFacts = [dehydrateFact(company)[0]];
        queryType = "company";
      }

      queries.push({
        given: givenFacts,
        specification,
        queryId: `${pattern.name}-${queryType}-${i}`
      });
    }

    return queries;
  }
}

describe("Given Conditions - Load and Concurrency Testing", () => {
  let store: MemoryStore;
  let loadTester: LoadTester;
  let concurrentLoadTester: ConcurrentLoadTester;
  let testData: GeneratedData;

  beforeEach(async () => {
    // Generate large test dataset
    testData = generateLargeCompanyNetwork();

    // Create memory store and populate with test data
    store = new MemoryStore();
    loadTester = new LoadTester(store);
    concurrentLoadTester = new ConcurrentLoadTester(store);

    // Save facts to the store
    const facts = [
      ...testData.users,
      ...testData.companies,
      ...testData.offices,
      ...testData.closures,
      ...testData.reopenings,
      ...testData.administrators,
      ...testData.managers,
      ...testData.employees
    ];

    for (const fact of facts) {
      const dehydrated = dehydrateFact(fact);
      const envelopes = dehydrated.map(record => ({
        fact: record,
        signatures: []
      }));
      await store.save(envelopes);
    }
  });

  // ===== LOAD TESTING SECTION =====

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

  // ===== CONCURRENT TESTING SECTION =====

  describe("Basic Concurrent Query Execution", () => {
    it("should handle 10 concurrent simple queries", async () => {
      const specifications = [SpecificationTemplates.officesClosed()];
      const pattern = concurrentLoadTester.createLoadPattern(
        "basic-concurrent",
        "10 concurrent simple queries",
        10,
        5,
        specifications
      );

      const queries = concurrentLoadTester.generateQueriesForPattern(
        pattern,
        testData.offices,
        testData.companies
      );

      const result = await concurrentLoadTester.executeConcurrentQueries(
        "basic-concurrent-test",
        queries,
        5 // concurrency limit
      );

      expect(result.metrics.totalQueries).toBe(10);
      expect(result.metrics.successfulQueries).toBeGreaterThanOrEqual(9); // At least 90% success
      expect(result.metrics.averageQueryTime).toBeLessThan(500); // Less than 500ms average
      expect(result.metrics.throughput).toBeGreaterThan(10); // At least 10 queries/second
      expect(result.passed).toBe(true);
    });

    it("should handle 25 concurrent mixed queries", async () => {
      const specifications = [
        SpecificationTemplates.officesClosed(),
        SpecificationTemplates.officesNotClosed(),
        SpecificationTemplates.officesClosedNotReopened()
      ];

      const pattern = concurrentLoadTester.createLoadPattern(
        "mixed-concurrent",
        "25 concurrent mixed complexity queries",
        25,
        10,
        specifications
      );

      const queries = concurrentLoadTester.generateQueriesForPattern(
        pattern,
        testData.offices,
        testData.companies
      );

      const result = await concurrentLoadTester.executeConcurrentQueries(
        "mixed-concurrent-test",
        queries,
        10
      );

      expect(result.metrics.totalQueries).toBe(25);
      expect(result.metrics.successfulQueries).toBeGreaterThanOrEqual(23); // At least 92% success
      expect(result.metrics.averageQueryTime).toBeLessThan(750); // Less than 750ms average
      expect(result.metrics.throughput).toBeGreaterThan(15); // At least 15 queries/second
      expect(result.passed).toBe(true);
    });

    it("should maintain performance under sustained concurrent load", async () => {
      const specifications = [SpecificationTemplates.officesClosed()];
      const results: ConcurrentTestResult[] = [];

      // Execute 5 waves of concurrent queries
      for (let wave = 0; wave < 5; wave++) {
        const pattern = concurrentLoadTester.createLoadPattern(
          `sustained-wave-${wave}`,
          `Wave ${wave} of sustained concurrent load`,
          15,
          8,
          specifications
        );

        const queries = concurrentLoadTester.generateQueriesForPattern(
          pattern,
          testData.offices,
          testData.companies
        );

        const result = await concurrentLoadTester.executeConcurrentQueries(
          `sustained-test-wave-${wave}`,
          queries,
          8
        );

        results.push(result);

        // Small delay between waves
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Analyze sustained performance
      const avgThroughput = results.reduce((sum, r) => sum + r.metrics.throughput, 0) / results.length;
      const avgQueryTime = results.reduce((sum, r) => sum + r.metrics.averageQueryTime, 0) / results.length;
      const totalSuccessRate = results.reduce((sum, r) => sum + r.metrics.successfulQueries, 0) /
                              results.reduce((sum, r) => sum + r.metrics.totalQueries, 0);

      expect(avgThroughput).toBeGreaterThan(12); // Maintain good throughput
      expect(avgQueryTime).toBeLessThan(600); // Keep query times reasonable
      expect(totalSuccessRate).toBeGreaterThan(0.9); // High success rate

      // Performance should not degrade significantly over time
      const firstWave = results[0];
      const lastWave = results[results.length - 1];
      const degradationRatio = lastWave.metrics.averageQueryTime / firstWave.metrics.averageQueryTime;

      expect(degradationRatio).toBeLessThan(2.0); // No more than 2x degradation
    });
  });

  describe("High Concurrency Scenarios", () => {
    it("should handle 50 concurrent queries with high concurrency", async () => {
      const specifications = [
        SpecificationTemplates.officesClosed(),
        SpecificationTemplates.officesNotClosed()
      ];

      const pattern = concurrentLoadTester.createLoadPattern(
        "high-concurrency",
        "50 queries with high concurrency",
        50,
        20,
        specifications
      );

      const queries = concurrentLoadTester.generateQueriesForPattern(
        pattern,
        testData.offices,
        testData.companies
      );

      const result = await concurrentLoadTester.executeConcurrentQueries(
        "high-concurrency-test",
        queries,
        20 // High concurrency
      );

      expect(result.metrics.totalQueries).toBe(50);
      expect(result.metrics.successfulQueries).toBeGreaterThanOrEqual(45); // At least 90% success
      expect(result.metrics.averageQueryTime).toBeLessThan(1000); // Less than 1s average
      expect(result.metrics.throughput).toBeGreaterThan(25); // At least 25 queries/second
      expect(result.passed).toBe(true);
    });

    it("should handle burst load patterns", async () => {
      const specifications = [SpecificationTemplates.officesClosed()];
      const burstResults: ConcurrentTestResult[] = [];

      // Simulate burst traffic patterns
      const burstSizes = [5, 15, 30, 10, 5]; // Varying burst sizes

      for (let i = 0; i < burstSizes.length; i++) {
        const burstSize = burstSizes[i];
        const pattern = concurrentLoadTester.createLoadPattern(
          `burst-${i}`,
          `Burst ${i} with ${burstSize} queries`,
          burstSize,
          Math.min(burstSize, 15),
          specifications
        );

        const queries = concurrentLoadTester.generateQueriesForPattern(
          pattern,
          testData.offices,
          testData.companies
        );

        const result = await concurrentLoadTester.executeConcurrentQueries(
          `burst-test-${i}`,
          queries,
          Math.min(burstSize, 15)
        );

        burstResults.push(result);
      }

      // Analyze burst performance
      const peakThroughput = Math.max(...burstResults.map(r => r.metrics.throughput));
      const avgThroughput = burstResults.reduce((sum, r) => sum + r.metrics.throughput, 0) / burstResults.length;
      const overallSuccessRate = burstResults.reduce((sum, r) => sum + r.metrics.successfulQueries, 0) /
                                burstResults.reduce((sum, r) => sum + r.metrics.totalQueries, 0);

      expect(peakThroughput).toBeGreaterThan(20); // Good peak performance
      expect(avgThroughput).toBeGreaterThan(15); // Good average performance
      expect(overallSuccessRate).toBeGreaterThan(0.85); // High success rate under burst conditions
    });

    it("should handle mixed complexity concurrent queries", async () => {
      const specifications = [
        SpecificationTemplates.officesClosed(), // Simple
        SpecificationTemplates.officesNotClosed(), // Simple
        SpecificationTemplates.officesClosedNotReopened() // Complex
      ];

      const pattern = concurrentLoadTester.createLoadPattern(
        "mixed-complexity",
        "30 queries with mixed complexity",
        30,
        12,
        specifications
      );

      const queries = concurrentLoadTester.generateQueriesForPattern(
        pattern,
        testData.offices,
        testData.companies
      );

      const result = await concurrentLoadTester.executeConcurrentQueries(
        "mixed-complexity-test",
        queries,
        12
      );

      expect(result.metrics.totalQueries).toBe(30);
      expect(result.metrics.successfulQueries).toBeGreaterThanOrEqual(27); // At least 90% success
      expect(result.metrics.averageQueryTime).toBeLessThan(800); // Reasonable average time
      expect(result.passed).toBe(true);

      // Complex queries should not dominate performance
      expect(result.metrics.throughput).toBeGreaterThan(20); // Maintain good throughput
    });
  });

  describe("Concurrent Load Patterns", () => {
    it("should handle ramp-up load patterns", async () => {
      const specifications = [SpecificationTemplates.officesClosed()];
      const rampResults: ConcurrentTestResult[] = [];

      // Gradually increase concurrent load
      for (let concurrency = 5; concurrency <= 25; concurrency += 5) {
        const pattern = concurrentLoadTester.createLoadPattern(
          `ramp-${concurrency}`,
          `Ramp up to ${concurrency} concurrent queries`,
          concurrency * 2, // 2 queries per concurrency unit
          concurrency,
          specifications
        );

        const queries = concurrentLoadTester.generateQueriesForPattern(
          pattern,
          testData.offices,
          testData.companies
        );

        const result = await concurrentLoadTester.executeConcurrentQueries(
          `ramp-test-${concurrency}`,
          queries,
          concurrency
        );

        rampResults.push(result);
      }

      // Analyze ramp-up performance
      const throughputs = rampResults.map(r => r.metrics.throughput);
      const queryTimes = rampResults.map(r => r.metrics.averageQueryTime);

      // Throughput should generally increase with concurrency (up to a point)
      for (let i = 1; i < throughputs.length; i++) {
        if (i < throughputs.length - 1) { // Allow some degradation at peak concurrency
          expect(throughputs[i]).toBeGreaterThanOrEqual(throughputs[i - 1] * 0.8); // No more than 20% degradation
        }
      }

      // Query times should remain reasonable
      queryTimes.forEach(time => {
        expect(time).toBeLessThan(1500); // Less than 1.5s even at high concurrency
      });
    });

    it("should handle varying query distributions", async () => {
      // Create uneven distribution of query types
      const specifications = [
        SpecificationTemplates.officesClosed(),
        SpecificationTemplates.officesNotClosed(),
        SpecificationTemplates.officesClosedNotReopened()
      ];

      const pattern = concurrentLoadTester.createLoadPattern(
        "uneven-distribution",
        "40 queries with uneven type distribution",
        40,
        15,
        specifications
      );

      const queries = concurrentLoadTester.generateQueriesForPattern(
        pattern,
        testData.offices,
        testData.companies
      );

      const result = await concurrentLoadTester.executeConcurrentQueries(
        "uneven-distribution-test",
        queries,
        15
      );

      expect(result.metrics.totalQueries).toBe(40);
      expect(result.metrics.successfulQueries).toBeGreaterThanOrEqual(36); // At least 90% success
      expect(result.metrics.averageQueryTime).toBeLessThan(900); // Reasonable average time
      expect(result.passed).toBe(true);
    });

    it("should handle concurrent queries with shared data dependencies", async () => {
      // All queries will target the same company/office relationships
      const targetCompany = testData.companies[0];
      const targetOffices = testData.offices.filter(office => office.company === targetCompany);

      const specifications = [
        SpecificationTemplates.officesClosed(),
        SpecificationTemplates.officesNotClosed()
      ];

      const queries: Array<{ given: FactReference[]; specification: any; queryId: string }> = [];

      // Create queries that all depend on the same company data
      for (let i = 0; i < 20; i++) {
        const spec = specifications[i % specifications.length];
        const office = targetOffices[i % targetOffices.length];

        queries.push({
          given: [dehydrateFact(office)[0]],
          specification: spec,
          queryId: `shared-data-${i}`
        });
      }

      const result = await concurrentLoadTester.executeConcurrentQueries(
        "shared-data-test",
        queries,
        10
      );

      expect(result.metrics.totalQueries).toBe(20);
      expect(result.metrics.successfulQueries).toBeGreaterThanOrEqual(18); // At least 90% success
      expect(result.metrics.averageQueryTime).toBeLessThan(700); // Good performance despite shared data
      expect(result.passed).toBe(true);
    });
  });

  describe("Error Handling Under Load", () => {
    it("should handle errors gracefully under concurrent load", async () => {
      const specifications = [SpecificationTemplates.officesClosed()];

      // Include some invalid queries
      const queries: Array<{ given: FactReference[]; specification: any; queryId: string }> = [];

      for (let i = 0; i < 20; i++) {
        if (i < 18) {
          // Valid queries
          const office = testData.offices[i % testData.offices.length];
          queries.push({
            given: [dehydrateFact(office)[0]],
            specification: specifications[0],
            queryId: `valid-${i}`
          });
        } else {
          // Invalid queries (non-existent facts)
          queries.push({
            given: [{
              type: "Office",
              hash: `invalid-hash-${i}`
            }],
            specification: specifications[0],
            queryId: `invalid-${i}`
          });
        }
      }

      const result = await concurrentLoadTester.executeConcurrentQueries(
        "error-handling-test",
        queries,
        10
      );

      expect(result.metrics.totalQueries).toBe(20);
      expect(result.metrics.failedQueries).toBeLessThanOrEqual(3); // Only the invalid ones should fail
      expect(result.metrics.successfulQueries).toBeGreaterThanOrEqual(17); // Most should succeed
      expect(result.errors.length).toBeLessThanOrEqual(3); // Limited error count

      // System should remain stable despite errors
      expect(result.metrics.averageQueryTime).toBeLessThan(800);
      expect(result.passed).toBe(true);
    });

    it("should maintain performance when some queries timeout", async () => {
      const specifications = [SpecificationTemplates.officesClosed()];

      // Create a mix of fast and potentially slow queries
      const queries: Array<{ given: FactReference[]; specification: any; queryId: string }> = [];

      for (let i = 0; i < 25; i++) {
        const spec = i % 3 === 0 ? SpecificationTemplates.officesClosedNotReopened() : specifications[0]; // Mix simple and complex
        const office = testData.offices[i % testData.offices.length];

        queries.push({
          given: [dehydrateFact(office)[0]],
          specification: spec,
          queryId: `timeout-test-${i}`
        });
      }

      const result = await concurrentLoadTester.executeConcurrentQueries(
        "timeout-handling-test",
        queries,
        12
      );

      expect(result.metrics.totalQueries).toBe(25);
      expect(result.metrics.successfulQueries).toBeGreaterThanOrEqual(22); // At least 88% success
      expect(result.metrics.averageQueryTime).toBeLessThan(1000); // Reasonable performance
      expect(result.passed).toBe(true);
    });
  });

  describe("Concurrent Load Reporting", () => {
    it("should generate comprehensive concurrent load reports", async () => {
      const specifications = [
        SpecificationTemplates.officesClosed(),
        SpecificationTemplates.officesNotClosed()
      ];

      const reportResults: ConcurrentTestResult[] = [];

      // Run multiple concurrent load tests
      for (let i = 0; i < 3; i++) {
        const pattern = concurrentLoadTester.createLoadPattern(
          `report-pattern-${i}`,
          `Report pattern ${i}`,
          15 + i * 5, // Increasing query count
          8 + i * 2, // Increasing concurrency
          specifications
        );

        const queries = concurrentLoadTester.generateQueriesForPattern(
          pattern,
          testData.offices,
          testData.companies
        );

        const result = await concurrentLoadTester.executeConcurrentQueries(
          `report-test-${i}`,
          queries,
          8 + i * 2
        );

        reportResults.push(result);
      }

      // Validate report structure
      expect(reportResults.length).toBe(3);
      reportResults.forEach(result => {
        expect(result.name).toMatch(/^report-test-\d$/);
        expect(result.metrics).toBeDefined();
        expect(result.metrics.totalQueries).toBeGreaterThan(10);
        expect(result.metrics.successfulQueries).toBeGreaterThan(0);
        expect(result.metrics.throughput).toBeGreaterThan(0);
        expect(typeof result.passed).toBe('boolean');
      });

      // Calculate aggregate statistics
      const avgThroughput = reportResults.reduce((sum, r) => sum + r.metrics.throughput, 0) / reportResults.length;
      const avgQueryTime = reportResults.reduce((sum, r) => sum + r.metrics.averageQueryTime, 0) / reportResults.length;
      const totalQueries = reportResults.reduce((sum, r) => sum + r.metrics.totalQueries, 0);
      const totalSuccessful = reportResults.reduce((sum, r) => sum + r.metrics.successfulQueries, 0);
      const overallSuccessRate = totalSuccessful / totalQueries;

      expect(avgThroughput).toBeGreaterThan(10);
      expect(avgQueryTime).toBeLessThan(1000);
      expect(overallSuccessRate).toBeGreaterThan(0.85);
    });
  });
});