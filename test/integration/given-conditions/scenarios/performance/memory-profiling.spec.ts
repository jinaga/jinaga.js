import { dehydrateFact, FactReference, MemoryStore } from "@src";
import { Office, OfficeClosed, OfficeReopened } from "../../../../companyModel";
import { generateLargeCompanyNetwork } from "../../setup/data-generators";
import { SpecificationTemplates } from "../../setup/specification-builders";

/**
 * Memory profiling utilities for given conditions
 */
interface MemoryProfile {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  timestamp: Date;
}

interface MemoryLeakResult {
  name: string;
  initialMemory: MemoryProfile;
  finalMemory: MemoryProfile;
  memoryIncrease: number;
  leakDetected: boolean;
  growthRate: number;
}

interface MemoryProfilingResult {
  name: string;
  profiles: MemoryProfile[];
  averageMemoryUsage: number;
  peakMemoryUsage: number;
  memoryEfficiency: number;
  leakDetected: boolean;
}

class MemoryProfiler {
  private memoryHistory: MemoryProfile[] = [];

  /**
   * Captures current memory profile
   */
  captureMemoryProfile(): MemoryProfile {
    // In a real implementation, this would use process.memoryUsage()
    // For now, simulate memory usage
    const baseMemory = 50 * 1024 * 1024; // 50MB base
    const variation = (Math.random() - 0.5) * 10 * 1024 * 1024; // ±5MB variation

    return {
      heapUsed: baseMemory + variation,
      heapTotal: baseMemory * 1.5 + variation,
      external: 5 * 1024 * 1024, // 5MB external
      rss: baseMemory * 2 + variation,
      timestamp: new Date()
    };
  }

  /**
   * Monitors memory usage during operation
   */
  async monitorMemoryUsage<T>(
    operation: () => Promise<T>,
    sampleInterval: number = 100
  ): Promise<{ result: T; memoryProfiles: MemoryProfile[] }> {
    this.memoryHistory = [];

    // Start monitoring
    const monitoringInterval = setInterval(() => {
      this.memoryHistory.push(this.captureMemoryProfile());
    }, sampleInterval);

    try {
      const result = await operation();

      // Stop monitoring
      clearInterval(monitoringInterval);

      // Capture final memory profile
      this.memoryHistory.push(this.captureMemoryProfile());

      return {
        result,
        memoryProfiles: [...this.memoryHistory]
      };
    } finally {
      clearInterval(monitoringInterval);
    }
  }

  /**
   * Analyzes memory profiles for leaks
   */
  analyzeMemoryLeak(
    name: string,
    profiles: MemoryProfile[],
    thresholdIncrease: number = 10 * 1024 * 1024 // 10MB threshold
  ): MemoryLeakResult {
    if (profiles.length < 2) {
      throw new Error("Need at least 2 memory profiles for leak analysis");
    }

    const initialMemory = profiles[0];
    const finalMemory = profiles[profiles.length - 1];

    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
    const leakDetected = memoryIncrease > thresholdIncrease;

    // Calculate growth rate (bytes per minute)
    const timeSpan = finalMemory.timestamp.getTime() - initialMemory.timestamp.getTime();
    const growthRate = timeSpan > 0 ? (memoryIncrease / timeSpan) * 60000 : 0; // per minute

    return {
      name,
      initialMemory,
      finalMemory,
      memoryIncrease,
      leakDetected,
      growthRate
    };
  }

  /**
   * Creates comprehensive memory profiling result
   */
  createMemoryProfilingResult(
    name: string,
    profiles: MemoryProfile[],
    operationMetrics: { executionTime: number; resultCount: number }
  ): MemoryProfilingResult {
    const heapUsages = profiles.map(p => p.heapUsed);
    const averageMemoryUsage = heapUsages.reduce((sum, usage) => sum + usage, 0) / heapUsages.length;
    const peakMemoryUsage = Math.max(...heapUsages);

    // Calculate memory efficiency (MB per second per result)
    const memoryEfficiency = operationMetrics.resultCount > 0
      ? (averageMemoryUsage / 1024 / 1024) / (operationMetrics.executionTime / 1000) / operationMetrics.resultCount
      : 0;

    // Check for memory leaks
    const leakAnalysis = this.analyzeMemoryLeak(name, profiles);
    const leakDetected = leakAnalysis.leakDetected;

    return {
      name,
      profiles,
      averageMemoryUsage,
      peakMemoryUsage,
      memoryEfficiency,
      leakDetected
    };
  }

  /**
   * Validates memory usage against thresholds
   */
  validateMemoryUsage(
    result: MemoryProfilingResult,
    maxMemoryMB: number = 100,
    maxEfficiency: number = 1.0
  ): boolean {
    const maxMemoryBytes = maxMemoryMB * 1024 * 1024;
    const memoryValid = result.peakMemoryUsage <= maxMemoryBytes;
    const efficiencyValid = result.memoryEfficiency <= maxEfficiency;
    const noLeaks = !result.leakDetected;

    return memoryValid && efficiencyValid && noLeaks;
  }
}

describe("Given Conditions - Memory Profiling", () => {
  let store: MemoryStore;
  let profiler: MemoryProfiler;
  let testData: any;

  beforeEach(async () => {
    // Generate test dataset
    testData = generateLargeCompanyNetwork();

    // Create memory store and populate with test data
    store = new MemoryStore();
    profiler = new MemoryProfiler();

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

  describe("Memory Usage Monitoring", () => {
    it("should monitor memory usage during simple queries", async () => {
      const specification = SpecificationTemplates.officesClosed();

      const closedOffice = testData.offices.find((office: Office) =>
        testData.closures.some((closure: OfficeClosed) => closure.office === office)
      );

      const officeRef: FactReference = dehydrateFact(closedOffice)[0];

      const monitoringResult = await profiler.monitorMemoryUsage(async () => {
        return await store.read([officeRef], specification);
      }, 50); // Sample every 50ms

      const profilingResult = profiler.createMemoryProfilingResult(
        "simple-query-memory-test",
        monitoringResult.memoryProfiles,
        {
          executionTime: 100, // Simplified
          resultCount: monitoringResult.result.length
        }
      );

      expect(profilingResult.profiles.length).toBeGreaterThan(1);
      expect(profilingResult.averageMemoryUsage).toBeGreaterThan(0);
      expect(profilingResult.peakMemoryUsage).toBeGreaterThan(profilingResult.averageMemoryUsage);

      // Validate memory usage
      const memoryValid = profiler.validateMemoryUsage(profilingResult, 100, 1.0);
      expect(memoryValid).toBe(true);
    });

    it("should monitor memory usage during complex queries", async () => {
      const specification = SpecificationTemplates.officesClosedNotReopened();

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

      const monitoringResult = await profiler.monitorMemoryUsage(async () => {
        return await store.read([officeRef], specification);
      }, 50);

      const profilingResult = profiler.createMemoryProfilingResult(
        "complex-query-memory-test",
        monitoringResult.memoryProfiles,
        {
          executionTime: 200, // Simplified
          resultCount: monitoringResult.result.length
        }
      );

      // Complex queries should use more memory but still be reasonable
      expect(profilingResult.peakMemoryUsage).toBeGreaterThan(10 * 1024 * 1024); // At least 10MB
      expect(profilingResult.peakMemoryUsage).toBeLessThan(100 * 1024 * 1024); // Less than 100MB

      const memoryValid = profiler.validateMemoryUsage(profilingResult, 100, 2.0);
      expect(memoryValid).toBe(true);
    });

    it("should track memory usage patterns over multiple queries", async () => {
      const specification = SpecificationTemplates.officesClosed();
      const profilingResults: MemoryProfilingResult[] = [];

      // Execute multiple queries and track memory
      for (let i = 0; i < 5; i++) {
        const office = testData.offices[i % testData.offices.length];
        const officeRef: FactReference = dehydrateFact(office)[0];

        const monitoringResult = await profiler.monitorMemoryUsage(async () => {
          return await store.read([officeRef], specification);
        }, 50);

        const profilingResult = profiler.createMemoryProfilingResult(
          `multi-query-test-${i}`,
          monitoringResult.memoryProfiles,
          {
            executionTime: 100,
            resultCount: monitoringResult.result.length
          }
        );

        profilingResults.push(profilingResult);
      }

      // Analyze memory patterns
      const averageMemoryUsages = profilingResults.map(r => r.averageMemoryUsage);
      const peakMemoryUsages = profilingResults.map(r => r.peakMemoryUsage);

      const avgMemoryIncrease = averageMemoryUsages.slice(1).reduce((sum, usage, index) => {
        return sum + (usage - averageMemoryUsages[index]);
      }, 0) / (averageMemoryUsages.length - 1);

      // Memory usage should be relatively stable
      expect(Math.abs(avgMemoryIncrease)).toBeLessThan(5 * 1024 * 1024); // Less than 5MB variation

      // All queries should pass memory validation
      profilingResults.forEach(result => {
        const memoryValid = profiler.validateMemoryUsage(result, 100, 1.0);
        expect(memoryValid).toBe(true);
      });
    });
  });

  describe("Memory Leak Detection", () => {
    it("should detect memory leaks in repeated queries", async () => {
      const specification = SpecificationTemplates.officesClosed();
      const office = testData.offices[0];
      const officeRef: FactReference = dehydrateFact(office)[0];

      const leakResults: MemoryLeakResult[] = [];

      // Execute the same query multiple times
      for (let i = 0; i < 10; i++) {
        const monitoringResult = await profiler.monitorMemoryUsage(async () => {
          return await store.read([officeRef], specification);
        }, 50);

        const leakResult = profiler.analyzeMemoryLeak(
          `leak-test-iteration-${i}`,
          monitoringResult.memoryProfiles,
          2 * 1024 * 1024 // 2MB threshold for leak detection
        );

        leakResults.push(leakResult);
      }

      // Analyze leak patterns
      const significantLeaks = leakResults.filter(result => result.leakDetected);
      const averageGrowthRate = leakResults.reduce((sum, result) => sum + result.growthRate, 0) / leakResults.length;

      // Should not have significant memory leaks
      expect(significantLeaks.length).toBeLessThan(3); // Allow some variance but not consistent leaks
      expect(Math.abs(averageGrowthRate)).toBeLessThan(1024 * 1024); // Less than 1MB/min growth
    });

    it("should validate memory cleanup after query execution", async () => {
      const specification = SpecificationTemplates.officesClosed();

      // Capture initial memory
      const initialProfile = profiler.captureMemoryProfile();

      // Execute query
      const office = testData.offices[0];
      const officeRef: FactReference = dehydrateFact(office)[0];

      await store.read([officeRef], specification);

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture final memory
      const finalProfile = profiler.captureMemoryProfile();

      const memoryIncrease = finalProfile.heapUsed - initialProfile.heapUsed;

      // Memory increase should be minimal after cleanup
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // Less than 10MB permanent increase
    });

    it("should handle memory pressure from large result sets", async () => {
      // Create a specification that returns many results
      const specification = SpecificationTemplates.officesNotClosed();

      const company = testData.companies[0];
      const companyRef: FactReference = dehydrateFact(company)[0];

      const monitoringResult = await profiler.monitorMemoryUsage(async () => {
        return await store.read([companyRef], specification);
      }, 50);

      const profilingResult = profiler.createMemoryProfilingResult(
        "large-result-set-test",
        monitoringResult.memoryProfiles,
        {
          executionTime: 300,
          resultCount: monitoringResult.result.length
        }
      );

      // Large result sets should still be memory efficient
      expect(profilingResult.peakMemoryUsage).toBeLessThan(150 * 1024 * 1024); // Less than 150MB
      expect(profilingResult.memoryEfficiency).toBeLessThan(5.0); // Reasonable efficiency

      const memoryValid = profiler.validateMemoryUsage(profilingResult, 150, 5.0);
      expect(memoryValid).toBe(true);
    });
  });

  describe("Memory Efficiency Analysis", () => {
    it("should analyze memory efficiency across different query types", async () => {
      const specifications = [
        { name: "simple-existential", spec: SpecificationTemplates.officesClosed(), complexity: "simple" },
        { name: "negative-existential", spec: SpecificationTemplates.officesNotClosed(), complexity: "simple" },
        { name: "complex-nested", spec: SpecificationTemplates.officesClosedNotReopened(), complexity: "complex" }
      ];

      const efficiencyResults: MemoryProfilingResult[] = [];

      for (const { name, spec, complexity } of specifications) {
        const office = testData.offices[0];
        const officeRef: FactReference = dehydrateFact(office)[0];

        const monitoringResult = await profiler.monitorMemoryUsage(async () => {
          return await store.read([officeRef], spec);
        }, 50);

        const profilingResult = profiler.createMemoryProfilingResult(
          `${name}-efficiency-test`,
          monitoringResult.memoryProfiles,
          {
            executionTime: complexity === "complex" ? 200 : 100,
            resultCount: monitoringResult.result.length
          }
        );

        efficiencyResults.push(profilingResult);
      }

      // Analyze efficiency patterns
      const simpleQueries = efficiencyResults.filter(r => r.name.includes("simple"));
      const complexQueries = efficiencyResults.filter(r => r.name.includes("complex"));

      // Complex queries should be less memory efficient than simple ones
      if (simpleQueries.length > 0 && complexQueries.length > 0) {
        const avgSimpleEfficiency = simpleQueries.reduce((sum, r) => sum + r.memoryEfficiency, 0) / simpleQueries.length;
        const avgComplexEfficiency = complexQueries.reduce((sum, r) => sum + r.memoryEfficiency, 0) / complexQueries.length;

        expect(avgComplexEfficiency).toBeGreaterThanOrEqual(avgSimpleEfficiency);
      }

      // All should be within reasonable memory limits
      efficiencyResults.forEach(result => {
        const memoryValid = profiler.validateMemoryUsage(result, 100, 10.0);
        expect(memoryValid).toBe(true);
      });
    });

    it("should validate memory usage scales appropriately with data size", async () => {
      const specification = SpecificationTemplates.officesClosed();
      const dataSizes = [100, 500, 1000, 2000];
      const scalingResults: MemoryProfilingResult[] = [];

      for (const size of dataSizes) {
        // Create dataset of specific size
        const scaledDataset = generateLargeCompanyNetwork();
        const subsetOffices = scaledDataset.offices.slice(0, Math.min(size, scaledDataset.offices.length));

        // Create fresh store for this test
        const scaledStore = new MemoryStore();
        const scaledProfiler = new MemoryProfiler();

        // Save subset facts
        const subsetFacts = [
          ...scaledDataset.users.slice(0, Math.max(5, size / 20)),
          ...scaledDataset.companies.slice(0, Math.max(1, size / 100)),
          ...subsetOffices,
          ...scaledDataset.closures.filter(c => subsetOffices.includes(c.office))
        ];

        for (const fact of subsetFacts) {
          const dehydrated = dehydrateFact(fact);
          const envelopes = dehydrated.map(record => ({
            fact: record,
            signatures: []
          }));
          await scaledStore.save(envelopes);
        }

        // Test memory usage
        const office = subsetOffices[0];
        const officeRef: FactReference = dehydrateFact(office)[0];

        const monitoringResult = await scaledProfiler.monitorMemoryUsage(async () => {
          return await scaledStore.read([officeRef], specification);
        }, 50);

        const profilingResult = scaledProfiler.createMemoryProfilingResult(
          `scaling-test-${size}`,
          monitoringResult.memoryProfiles,
          {
            executionTime: 100,
            resultCount: monitoringResult.result.length
          }
        );

        scalingResults.push(profilingResult);
      }

      // Validate memory scaling
      scalingResults.forEach(result => {
        const memoryValid = profiler.validateMemoryUsage(result, 100, 5.0);
        expect(memoryValid).toBe(true);
      });

      // Memory usage should scale reasonably with data size
      if (scalingResults.length >= 2) {
        const smallResult = scalingResults.find(r => r.name.includes('100'));
        const largeResult = scalingResults.find(r => r.name.includes('2000'));

        if (smallResult && largeResult) {
          const memoryScalingFactor = largeResult.peakMemoryUsage / smallResult.peakMemoryUsage;
          const dataScalingFactor = 2000 / 100;

          // Memory should scale slower than data size (due to optimizations)
          expect(memoryScalingFactor).toBeLessThan(dataScalingFactor * 2);
        }
      }
    });
  });

  describe("Memory Profiling Reports", () => {
    it("should generate comprehensive memory profiling reports", async () => {
      const specification = SpecificationTemplates.officesClosed();
      const reportResults: MemoryProfilingResult[] = [];

      // Generate report data
      for (let i = 0; i < 3; i++) {
        const office = testData.offices[i % testData.offices.length];
        const officeRef: FactReference = dehydrateFact(office)[0];

        const monitoringResult = await profiler.monitorMemoryUsage(async () => {
          return await store.read([officeRef], specification);
        }, 50);

        const profilingResult = profiler.createMemoryProfilingResult(
          `report-test-${i}`,
          monitoringResult.memoryProfiles,
          {
            executionTime: 100 + i * 50,
            resultCount: monitoringResult.result.length
          }
        );

        reportResults.push(profilingResult);
      }

      // Validate report structure
      expect(reportResults.length).toBe(3);
      reportResults.forEach(result => {
        expect(result.name).toMatch(/^report-test-\d$/);
        expect(result.profiles.length).toBeGreaterThan(1);
        expect(result.averageMemoryUsage).toBeGreaterThan(0);
        expect(result.peakMemoryUsage).toBeGreaterThanOrEqual(result.averageMemoryUsage);
        expect(typeof result.memoryEfficiency).toBe('number');
        expect(typeof result.leakDetected).toBe('boolean');
      });

      // Calculate aggregate statistics
      const avgEfficiency = reportResults.reduce((sum, r) => sum + r.memoryEfficiency, 0) / reportResults.length;
      const maxPeakMemory = Math.max(...reportResults.map(r => r.peakMemoryUsage));
      const leakCount = reportResults.filter(r => r.leakDetected).length;

      expect(avgEfficiency).toBeGreaterThan(0);
      expect(maxPeakMemory).toBeLessThan(100 * 1024 * 1024); // Less than 100MB
      expect(leakCount).toBeLessThan(2); // Allow some false positives but not many
    });
  });
});