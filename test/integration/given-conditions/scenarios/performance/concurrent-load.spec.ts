import { dehydrateFact, FactReference, MemoryStore } from "@src";
import { Company, Office } from "../../../../companyModel";
import { GeneratedData, generateLargeCompanyNetwork } from "../../setup/data-generators";
import { SpecificationTemplates } from "../../setup/specification-builders";

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

describe("Given Conditions - Concurrent Load Testing", () => {
  let store: MemoryStore;
  let loadTester: ConcurrentLoadTester;
  let testData: GeneratedData;

  beforeEach(async () => {
    // Generate large test dataset
    testData = generateLargeCompanyNetwork();

    // Create memory store and populate with test data
    store = new MemoryStore();
    loadTester = new ConcurrentLoadTester(store);

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

  describe("Basic Concurrent Query Execution", () => {
    it("should handle 10 concurrent simple queries", async () => {
      const specifications = [SpecificationTemplates.officesClosed()];
      const pattern = loadTester.createLoadPattern(
        "basic-concurrent",
        "10 concurrent simple queries",
        10,
        5,
        specifications
      );

      const queries = loadTester.generateQueriesForPattern(
        pattern,
        testData.offices,
        testData.companies
      );

      const result = await loadTester.executeConcurrentQueries(
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

      const pattern = loadTester.createLoadPattern(
        "mixed-concurrent",
        "25 concurrent mixed complexity queries",
        25,
        10,
        specifications
      );

      const queries = loadTester.generateQueriesForPattern(
        pattern,
        testData.offices,
        testData.companies
      );

      const result = await loadTester.executeConcurrentQueries(
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
        const pattern = loadTester.createLoadPattern(
          `sustained-wave-${wave}`,
          `Wave ${wave} of sustained concurrent load`,
          15,
          8,
          specifications
        );

        const queries = loadTester.generateQueriesForPattern(
          pattern,
          testData.offices,
          testData.companies
        );

        const result = await loadTester.executeConcurrentQueries(
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

      const pattern = loadTester.createLoadPattern(
        "high-concurrency",
        "50 queries with high concurrency",
        50,
        20,
        specifications
      );

      const queries = loadTester.generateQueriesForPattern(
        pattern,
        testData.offices,
        testData.companies
      );

      const result = await loadTester.executeConcurrentQueries(
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
        const pattern = loadTester.createLoadPattern(
          `burst-${i}`,
          `Burst ${i} with ${burstSize} queries`,
          burstSize,
          Math.min(burstSize, 15),
          specifications
        );

        const queries = loadTester.generateQueriesForPattern(
          pattern,
          testData.offices,
          testData.companies
        );

        const result = await loadTester.executeConcurrentQueries(
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

      const pattern = loadTester.createLoadPattern(
        "mixed-complexity",
        "30 queries with mixed complexity",
        30,
        12,
        specifications
      );

      const queries = loadTester.generateQueriesForPattern(
        pattern,
        testData.offices,
        testData.companies
      );

      const result = await loadTester.executeConcurrentQueries(
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
        const pattern = loadTester.createLoadPattern(
          `ramp-${concurrency}`,
          `Ramp up to ${concurrency} concurrent queries`,
          concurrency * 2, // 2 queries per concurrency unit
          concurrency,
          specifications
        );

        const queries = loadTester.generateQueriesForPattern(
          pattern,
          testData.offices,
          testData.companies
        );

        const result = await loadTester.executeConcurrentQueries(
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

      const pattern = loadTester.createLoadPattern(
        "uneven-distribution",
        "40 queries with uneven type distribution",
        40,
        15,
        specifications
      );

      const queries = loadTester.generateQueriesForPattern(
        pattern,
        testData.offices,
        testData.companies
      );

      const result = await loadTester.executeConcurrentQueries(
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

      const result = await loadTester.executeConcurrentQueries(
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

      const result = await loadTester.executeConcurrentQueries(
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

      const result = await loadTester.executeConcurrentQueries(
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
        const pattern = loadTester.createLoadPattern(
          `report-pattern-${i}`,
          `Report pattern ${i}`,
          15 + i * 5, // Increasing query count
          8 + i * 2, // Increasing concurrency
          specifications
        );

        const queries = loadTester.generateQueriesForPattern(
          pattern,
          testData.offices,
          testData.companies
        );

        const result = await loadTester.executeConcurrentQueries(
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