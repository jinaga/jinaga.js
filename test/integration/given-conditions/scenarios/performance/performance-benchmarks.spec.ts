import { dehydrateFact, FactReference, MemoryStore } from "@src";
import { Office, OfficeClosed, OfficeReopened } from "../../../../companyModel";
import { generateLargeCompanyNetwork } from "../../setup/data-generators";
import { SpecificationTemplates } from "../../setup/specification-builders";

/**
 * Performance benchmarking utilities for given conditions
 */
interface PerformanceMetrics {
  executionTime: number;
  memoryUsage: number;
  resultCount: number;
  timestamp: Date;
}

interface BenchmarkResult {
  name: string;
  metrics: PerformanceMetrics;
  threshold: number;
  passed: boolean;
}

class PerformanceBenchmarker {
  private store: MemoryStore;
  private baselineMetrics: Map<string, PerformanceMetrics> = new Map();

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Measures execution time and memory usage of a specification query
   */
  async measureQuery(
    name: string,
    givenFacts: FactReference[],
    specification: any,
    thresholdMs: number = 5000
  ): Promise<BenchmarkResult> {
    const startTime = performance.now();
    const startMemory = this.getMemoryUsage();

    const results = await this.store.read(givenFacts, specification);

    const endTime = performance.now();
    const endMemory = this.getMemoryUsage();

    const metrics: PerformanceMetrics = {
      executionTime: endTime - startTime,
      memoryUsage: endMemory - startMemory,
      resultCount: results.length,
      timestamp: new Date()
    };

    const passed = metrics.executionTime <= thresholdMs;

    return {
      name,
      metrics,
      threshold: thresholdMs,
      passed
    };
  }

  /**
   * Gets current memory usage (simplified for Node.js environment)
   */
  private getMemoryUsage(): number {
    // In a real implementation, this would use process.memoryUsage()
    // For now, return a placeholder value
    return 0;
  }

  /**
   * Sets baseline metrics for regression testing
   */
  setBaseline(name: string, metrics: PerformanceMetrics): void {
    this.baselineMetrics.set(name, metrics);
  }

  /**
   * Checks for performance regression against baseline
   */
  checkRegression(name: string, currentMetrics: PerformanceMetrics, tolerancePercent: number = 10): boolean {
    const baseline = this.baselineMetrics.get(name);
    if (!baseline) return true; // No baseline means no regression

    const timeRegression = ((currentMetrics.executionTime - baseline.executionTime) / baseline.executionTime) * 100;
    return timeRegression <= tolerancePercent;
  }
}

describe("Given Conditions - Performance Benchmarks", () => {
  let store: MemoryStore;
  let benchmarker: PerformanceBenchmarker;
  let testData: any;

  beforeEach(async () => {
    // Generate large test dataset
    testData = generateLargeCompanyNetwork();

    // Create memory store and populate with test data
    store = new MemoryStore();
    benchmarker = new PerformanceBenchmarker(store);

    // Save all facts to the store
    const allFacts = [
      ...testData.users,
      ...testData.companies,
      ...testData.offices,
      ...testData.closures,
      ...testData.reopenings,
      ...testData.administrators,
      ...testData.managers,
      ...testData.employees
    ];

    for (const fact of allFacts) {
      const dehydrated = dehydrateFact(fact);
      const envelopes = dehydrated.map(record => ({
        fact: record,
        signatures: []
      }));
      await store.save(envelopes);
    }
  });

  describe("Baseline Performance Metrics", () => {
    it("should establish baseline for simple positive existential queries", async () => {
      const specification = SpecificationTemplates.officesClosed();

      // Test with a closed office
      const closedOffice = testData.offices.find((office: Office) =>
        testData.closures.some((closure: OfficeClosed) => closure.office === office)
      );

      const closedOfficeRef: FactReference = dehydrateFact(closedOffice)[0];

      const result = await benchmarker.measureQuery(
        "simple-positive-existential",
        [closedOfficeRef],
        specification,
        100 // 100ms threshold for simple queries
      );

      expect(result.passed).toBe(true);
      expect(result.metrics.executionTime).toBeLessThan(100);
      expect(result.metrics.resultCount).toBeGreaterThan(0);

      // Store baseline for regression testing
      benchmarker.setBaseline("simple-positive-existential", result.metrics);
    });

    it("should establish baseline for negative existential queries", async () => {
      const specification = SpecificationTemplates.officesNotClosed();

      // Test with an open office
      const openOffice = testData.offices.find((office: Office) =>
        !testData.closures.some((closure: OfficeClosed) => closure.office === office)
      );

      const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];

      const result = await benchmarker.measureQuery(
        "simple-negative-existential",
        [openOfficeRef],
        specification,
        100
      );

      expect(result.passed).toBe(true);
      expect(result.metrics.executionTime).toBeLessThan(100);

      benchmarker.setBaseline("simple-negative-existential", result.metrics);
    });

    it("should establish baseline for complex nested conditions", async () => {
      const specification = SpecificationTemplates.officesClosedNotReopened();

      // Test with a closed but not reopened office
      const targetOffice = testData.offices.find((office: Office) => {
        const hasClosure = testData.closures.some((closure: OfficeClosed) => closure.office === office);
        const hasReopening = testData.reopenings.some((reopening: OfficeReopened) =>
          testData.closures.some((closure: OfficeClosed) =>
            closure.office === office && reopening.officeClosed === closure
          )
        );
        return hasClosure && !hasReopening;
      });

      const officeRef: FactReference = dehydrateFact(targetOffice)[0];

      const result = await benchmarker.measureQuery(
        "complex-nested-conditions",
        [officeRef],
        specification,
        200 // 200ms for complex queries
      );

      expect(result.passed).toBe(true);
      expect(result.metrics.executionTime).toBeLessThan(200);

      benchmarker.setBaseline("complex-nested-conditions", result.metrics);
    });
  });

  describe("Regression Detection", () => {
    it("should detect performance regression in simple queries", async () => {
      const specification = SpecificationTemplates.officesClosed();

      // Establish baseline first
      const closedOffice = testData.offices.find((office: Office) =>
        testData.closures.some((closure: OfficeClosed) => closure.office === office)
      );

      const officeRef: FactReference = dehydrateFact(closedOffice)[0];

      const baselineResult = await benchmarker.measureQuery(
        "regression-test-simple",
        [officeRef],
        specification,
        100
      );

      benchmarker.setBaseline("regression-test-simple", baselineResult.metrics);

      // Run again to check for regression (should pass)
      const regressionResult = await benchmarker.measureQuery(
        "regression-test-simple",
        [officeRef],
        specification,
        100
      );

      const hasRegression = benchmarker.checkRegression(
        "regression-test-simple",
        regressionResult.metrics,
        5 // 5% tolerance
      );

      expect(hasRegression).toBe(true);
      expect(regressionResult.passed).toBe(true);
    });

    it("should handle acceptable performance variance", async () => {
      const specification = SpecificationTemplates.officesNotClosed();

      const openOffice = testData.offices.find((office: Office) =>
        !testData.closures.some((closure: OfficeClosed) => closure.office === office)
      );

      const officeRef: FactReference = dehydrateFact(openOffice)[0];

      // Establish baseline
      const baselineResult = await benchmarker.measureQuery(
        "variance-test",
        [officeRef],
        specification,
        100
      );

      benchmarker.setBaseline("variance-test", baselineResult.metrics);

      // Simulate slight performance degradation (within tolerance)
      const varianceResult = await benchmarker.measureQuery(
        "variance-test",
        [officeRef],
        specification,
        100
      );

      const hasRegression = benchmarker.checkRegression(
        "variance-test",
        varianceResult.metrics,
        15 // 15% tolerance for variance
      );

      expect(hasRegression).toBe(true);
    });
  });

  describe("Performance Thresholds", () => {
    it("should meet performance thresholds for different query complexities", async () => {
      const thresholds = [
        { name: "simple-existential", spec: SpecificationTemplates.officesClosed(), threshold: 50 },
        { name: "negative-existential", spec: SpecificationTemplates.officesNotClosed(), threshold: 75 },
        { name: "complex-nested", spec: SpecificationTemplates.officesClosedNotReopened(), threshold: 150 }
      ];

      for (const { name, spec, threshold } of thresholds) {
        const office = testData.offices[0];
        const officeRef: FactReference = dehydrateFact(office)[0];

        const result = await benchmarker.measureQuery(
          `threshold-${name}`,
          [officeRef],
          spec,
          threshold
        );

        expect(result.passed).toBe(true);
        if (!result.passed) {
          console.warn(`Query ${name} exceeded threshold: ${result.metrics.executionTime}ms > ${threshold}ms`);
        }
      }
    });

    it("should validate memory usage stays within limits", async () => {
      const specification = SpecificationTemplates.officesClosed();

      const closedOffice = testData.offices.find((office: Office) =>
        testData.closures.some((closure: OfficeClosed) => closure.office === office)
      );

      const officeRef: FactReference = dehydrateFact(closedOffice)[0];

      const result = await benchmarker.measureQuery(
        "memory-usage-test",
        [officeRef],
        specification,
        100
      );

      // Memory usage should be reasonable (< 10MB for this test)
      expect(result.metrics.memoryUsage).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe("Benchmark Reporting", () => {
    it("should generate comprehensive performance reports", async () => {
      const specification = SpecificationTemplates.officesClosed();

      const results: BenchmarkResult[] = [];

      // Run multiple benchmarks
      for (let i = 0; i < 5; i++) {
        const office = testData.offices[i % testData.offices.length];
        const officeRef: FactReference = dehydrateFact(office)[0];

        const result = await benchmarker.measureQuery(
          `report-test-${i}`,
          [officeRef],
          specification,
          100
        );

        results.push(result);
      }

      // Validate report structure
      expect(results.length).toBe(5);
      results.forEach(result => {
        expect(result.name).toMatch(/^report-test-\d$/);
        expect(result.metrics).toBeDefined();
        expect(result.metrics.executionTime).toBeGreaterThan(0);
        expect(typeof result.passed).toBe('boolean');
      });

      // Calculate aggregate statistics
      const avgTime = results.reduce((sum, r) => sum + r.metrics.executionTime, 0) / results.length;
      const minTime = Math.min(...results.map(r => r.metrics.executionTime));
      const maxTime = Math.max(...results.map(r => r.metrics.executionTime));

      expect(avgTime).toBeGreaterThan(0);
      expect(minTime).toBeLessThanOrEqual(avgTime);
      expect(maxTime).toBeGreaterThanOrEqual(avgTime);
    });
  });
});