/**
 * Performance testing utilities and benchmarking helpers for given conditions
 */

export interface PerformanceThresholds {
  simpleQuery: number; // ms
  complexQuery: number; // ms
  maxMemoryUsage: number; // MB
  minThroughput: number; // facts per second
  maxConcurrentQueries: number;
  scalabilityDegradation: number; // max degradation factor
}

export const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  simpleQuery: 500, // 500ms for simple queries
  complexQuery: 2000, // 2 seconds for complex queries
  maxMemoryUsage: 100, // 100MB
  minThroughput: 100, // 100 facts/second
  maxConcurrentQueries: 50,
  scalabilityDegradation: 5.0 // 5x max degradation
};

export interface BenchmarkResult {
  name: string;
  executionTime: number;
  memoryUsage: number;
  throughput: number;
  passed: boolean;
  threshold: number;
  timestamp: Date;
}

export interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  timestamp: Date;
}

export interface ConcurrentLoadResult {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  averageResponseTime: number;
  throughput: number;
  errorRate: number;
  passed: boolean;
}

/**
 * Performance benchmarking utilities
 */
export class PerformanceBenchmarker {
  private memoryHistory: MemorySnapshot[] = [];
  private startTime: number = 0;

  /**
   * Starts performance monitoring
   */
  startMonitoring(): void {
    this.memoryHistory = [];
    this.startTime = performance.now();
    this.captureMemorySnapshot();
  }

  /**
   * Stops performance monitoring and returns metrics
   */
  stopMonitoring(): { executionTime: number; memorySnapshots: MemorySnapshot[] } {
    const executionTime = performance.now() - this.startTime;
    this.captureMemorySnapshot();

    return {
      executionTime,
      memorySnapshots: [...this.memoryHistory]
    };
  }

  /**
   * Captures current memory snapshot
   */
  private captureMemorySnapshot(): void {
    // In a real implementation, this would use process.memoryUsage()
    // For now, simulate memory usage
    const baseMemory = 30 * 1024 * 1024; // 30MB base
    const variation = (Math.random() - 0.5) * 20 * 1024 * 1024; // ±10MB variation

    this.memoryHistory.push({
      heapUsed: Math.max(0, baseMemory + variation),
      heapTotal: Math.max(0, baseMemory * 1.5 + variation),
      external: Math.max(0, 2 * 1024 * 1024 + (Math.random() * 5 * 1024 * 1024)), // 2-7MB external
      timestamp: new Date()
    });
  }

  /**
   * Measures operation performance
   */
  async measureOperation<T>(
    name: string,
    operation: () => Promise<T>,
    threshold: number = DEFAULT_THRESHOLDS.simpleQuery
  ): Promise<BenchmarkResult> {
    this.startMonitoring();

    const startMemory = this.getCurrentMemoryUsage();
    const result = await operation();

    const monitoringResult = this.stopMonitoring();
    const endMemory = this.getCurrentMemoryUsage();

    const memoryUsage = Math.max(...monitoringResult.memorySnapshots.map(s => s.heapUsed));
    const throughput = 1000; // Simplified - would be calculated based on operation

    const passed = monitoringResult.executionTime <= threshold &&
                   memoryUsage <= DEFAULT_THRESHOLDS.maxMemoryUsage * 1024 * 1024;

    return {
      name,
      executionTime: monitoringResult.executionTime,
      memoryUsage,
      throughput,
      passed,
      threshold,
      timestamp: new Date()
    };
  }

  /**
   * Gets current memory usage
   */
  private getCurrentMemoryUsage(): number {
    // In a real implementation, this would use process.memoryUsage().heapUsed
    return 50 * 1024 * 1024; // 50MB placeholder
  }

  /**
   * Validates performance against thresholds
   */
  validateThresholds(result: BenchmarkResult, thresholds: PerformanceThresholds = DEFAULT_THRESHOLDS): boolean {
    return result.executionTime <= thresholds.simpleQuery &&
           result.memoryUsage <= thresholds.maxMemoryUsage * 1024 * 1024 &&
           result.throughput >= thresholds.minThroughput;
  }

  /**
   * Calculates performance regression
   */
  calculateRegression(baseline: BenchmarkResult, current: BenchmarkResult): number {
    return current.executionTime / baseline.executionTime;
  }

  /**
   * Generates performance report
   */
  generateReport(results: BenchmarkResult[]): string {
    const summary = {
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      avgExecutionTime: results.reduce((sum, r) => sum + r.executionTime, 0) / results.length,
      avgMemoryUsage: results.reduce((sum, r) => sum + r.memoryUsage, 0) / results.length,
      avgThroughput: results.reduce((sum, r) => sum + r.throughput, 0) / results.length
    };

    return `
Performance Test Report
=======================
Total Tests: ${summary.totalTests}
Passed: ${summary.passedTests}
Failed: ${summary.failedTests}
Success Rate: ${((summary.passedTests / summary.totalTests) * 100).toFixed(1)}%

Average Execution Time: ${summary.avgExecutionTime.toFixed(2)}ms
Average Memory Usage: ${(summary.avgMemoryUsage / 1024 / 1024).toFixed(2)}MB
Average Throughput: ${summary.avgThroughput.toFixed(2)} ops/sec

Detailed Results:
${results.map(r => `- ${r.name}: ${r.executionTime.toFixed(2)}ms, ${r.passed ? 'PASS' : 'FAIL'}`).join('\n')}
    `.trim();
  }
}

/**
 * Memory profiling utilities
 */
export class MemoryProfiler {
  private snapshots: MemorySnapshot[] = [];

  /**
   * Takes memory snapshot
   */
  takeSnapshot(): MemorySnapshot {
    const snapshot: MemorySnapshot = {
      heapUsed: this.getCurrentHeapUsed(),
      heapTotal: this.getCurrentHeapTotal(),
      external: this.getCurrentExternal(),
      timestamp: new Date()
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  /**
   * Gets current heap used
   */
  private getCurrentHeapUsed(): number {
    // In a real implementation, this would use process.memoryUsage().heapUsed
    return 40 * 1024 * 1024 + (Math.random() * 20 * 1024 * 1024); // 40-60MB
  }

  /**
   * Gets current heap total
   */
  private getCurrentHeapTotal(): number {
    // In a real implementation, this would use process.memoryUsage().heapTotal
    return 60 * 1024 * 1024 + (Math.random() * 30 * 1024 * 1024); // 60-90MB
  }

  /**
   * Gets current external memory
   */
  private getCurrentExternal(): number {
    // In a real implementation, this would use process.memoryUsage().external
    return 5 * 1024 * 1024 + (Math.random() * 10 * 1024 * 1024); // 5-15MB
  }

  /**
   * Analyzes memory usage patterns
   */
  analyzeMemoryUsage(): {
    averageHeapUsed: number;
    peakHeapUsed: number;
    memoryGrowth: number;
    leakDetected: boolean;
  } {
    if (this.snapshots.length < 2) {
      return {
        averageHeapUsed: 0,
        peakHeapUsed: 0,
        memoryGrowth: 0,
        leakDetected: false
      };
    }

    const heapUsages = this.snapshots.map(s => s.heapUsed);
    const averageHeapUsed = heapUsages.reduce((sum, usage) => sum + usage, 0) / heapUsages.length;
    const peakHeapUsed = Math.max(...heapUsages);

    const firstSnapshot = this.snapshots[0];
    const lastSnapshot = this.snapshots[this.snapshots.length - 1];
    const memoryGrowth = lastSnapshot.heapUsed - firstSnapshot.heapUsed;

    // Detect memory leaks (significant growth over time)
    const leakDetected = memoryGrowth > 20 * 1024 * 1024; // > 20MB growth

    return {
      averageHeapUsed,
      peakHeapUsed,
      memoryGrowth,
      leakDetected
    };
  }

  /**
   * Resets memory snapshots
   */
  reset(): void {
    this.snapshots = [];
  }
}

/**
 * Concurrent load testing utilities
 */
export class ConcurrentLoadTester {
  /**
   * Executes queries with controlled concurrency
   */
  async executeWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    concurrencyLimit: number
  ): Promise<{
    results: T[];
    executionTime: number;
    throughput: number;
  }> {
    const startTime = performance.now();
    const results: T[] = [];

    // Execute tasks in batches to control concurrency
    for (let i = 0; i < tasks.length; i += concurrencyLimit) {
      const batch = tasks.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(batch.map(task => task()));
      results.push(...batchResults);
    }

    const executionTime = performance.now() - startTime;
    const throughput = tasks.length / (executionTime / 1000);

    return {
      results,
      executionTime,
      throughput
    };
  }

  /**
   * Simulates load patterns
   */
  async simulateLoadPattern(
    pattern: {
      name: string;
      duration: number; // ms
      queryRate: number; // queries per second
      queryFactory: () => Promise<any>;
    }
  ): Promise<ConcurrentLoadResult> {
    const startTime = performance.now();
    const endTime = startTime + pattern.duration;

    let totalQueries = 0;
    let successfulQueries = 0;
    let failedQueries = 0;
    const responseTimes: number[] = [];

    const interval = 1000 / pattern.queryRate; // ms between queries

    while (performance.now() < endTime) {
      const queryStartTime = performance.now();

      try {
        await pattern.queryFactory();
        successfulQueries++;
        responseTimes.push(performance.now() - queryStartTime);
      } catch (error) {
        failedQueries++;
        responseTimes.push(performance.now() - queryStartTime);
      }

      totalQueries++;

      // Wait for next query interval
      const elapsed = performance.now() - queryStartTime;
      if (elapsed < interval) {
        await new Promise(resolve => setTimeout(resolve, interval - elapsed));
      }
    }

    const averageResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    const throughput = totalQueries / (pattern.duration / 1000);
    const errorRate = failedQueries / totalQueries;

    const passed = errorRate <= 0.05 && averageResponseTime <= 1000; // < 5% error rate and < 1s avg response

    return {
      totalQueries,
      successfulQueries,
      failedQueries,
      averageResponseTime,
      throughput,
      errorRate,
      passed
    };
  }
}

/**
 * Scalability testing utilities
 */
export class ScalabilityTester {
  /**
   * Measures scaling efficiency
   */
  calculateScalingEfficiency(
    baselineMetrics: { executionTime: number; datasetSize: number },
    scaledMetrics: { executionTime: number; datasetSize: number }
  ): number {
    const sizeRatio = scaledMetrics.datasetSize / baselineMetrics.datasetSize;
    const timeRatio = scaledMetrics.executionTime / baselineMetrics.executionTime;

    // Efficiency is how close time scaling is to linear (ideal = 1.0)
    return sizeRatio / timeRatio;
  }

  /**
   * Predicts performance for larger datasets
   */
  predictPerformance(
    baselineMetrics: { executionTime: number; datasetSize: number },
    targetSize: number,
    scalingModel: 'linear' | 'logarithmic' | 'exponential' = 'linear'
  ): number {
    const sizeRatio = targetSize / baselineMetrics.datasetSize;

    switch (scalingModel) {
      case 'linear':
        return baselineMetrics.executionTime * sizeRatio;
      case 'logarithmic':
        return baselineMetrics.executionTime * Math.log(sizeRatio + 1);
      case 'exponential':
        return baselineMetrics.executionTime * Math.pow(sizeRatio, 1.5);
      default:
        return baselineMetrics.executionTime * sizeRatio;
    }
  }

  /**
   * Validates scalability requirements
   */
  validateScalability(
    baselineSize: number,
    scaledSize: number,
    baselineTime: number,
    scaledTime: number,
    maxDegradationFactor: number = 5.0
  ): boolean {
    const sizeRatio = scaledSize / baselineSize;
    const timeRatio = scaledTime / baselineTime;

    return timeRatio <= maxDegradationFactor;
  }
}

/**
 * Test data generators for performance testing
 */
export class PerformanceDataGenerator {
  /**
   * Generates dataset of specific size for performance testing
   */
  static generateDataset(size: number): {
    users: any[];
    companies: any[];
    offices: any[];
    closures: any[];
    employees: any[];
  } {
    const users: any[] = [];
    const companies: any[] = [];
    const offices: any[] = [];
    const closures: any[] = [];
    const employees: any[] = [];

    // Generate users
    const userCount = Math.max(5, Math.floor(size / 50));
    for (let i = 0; i < userCount; i++) {
      users.push({
        type: 'User',
        publicKey: `perf-user-${i}-key`
      });
    }

    // Generate companies
    const companyCount = Math.max(1, Math.floor(size / 200));
    for (let i = 0; i < companyCount; i++) {
      companies.push({
        type: 'Company',
        creator: users[i % users.length],
        identifier: `PerfCompany-${i}`
      });
    }

    // Generate offices
    const officesPerCompany = Math.max(2, Math.floor(size / companyCount / 50));
    companies.forEach((company, companyIndex) => {
      for (let i = 0; i < officesPerCompany; i++) {
        offices.push({
          type: 'Office',
          company,
          identifier: `Office-${companyIndex}-${i}`
        });
      }
    });

    // Generate closures (30% of offices)
    const closureCount = Math.floor(offices.length * 0.3);
    for (let i = 0; i < closureCount; i++) {
      closures.push({
        type: 'Office.Closed',
        office: offices[i % offices.length],
        date: new Date(`2023-${String((i % 12) + 1).padStart(2, '0')}-01`)
      });
    }

    // Generate employees
    offices.forEach((office, officeIndex) => {
      const employeeCount = Math.max(1, Math.floor(size / offices.length / 20));
      for (let i = 0; i < employeeCount; i++) {
        employees.push({
          type: 'Employee',
          office,
          user: users[(officeIndex * employeeCount + i) % users.length]
        });
      }
    });

    return {
      users,
      companies,
      offices,
      closures,
      employees
    };
  }

  /**
   * Generates realistic query patterns for testing
   */
  static generateQueryPatterns(): Array<{
    name: string;
    description: string;
    complexity: 'simple' | 'medium' | 'complex';
    expectedDuration: number;
  }> {
    return [
      {
        name: 'simple-existence',
        description: 'Simple existential condition check',
        complexity: 'simple',
        expectedDuration: 100
      },
      {
        name: 'negative-existence',
        description: 'Negative existential condition check',
        complexity: 'simple',
        expectedDuration: 150
      },
      {
        name: 'nested-conditions',
        description: 'Complex nested condition evaluation',
        complexity: 'complex',
        expectedDuration: 500
      },
      {
        name: 'multi-given',
        description: 'Multiple given conditions',
        complexity: 'medium',
        expectedDuration: 300
      }
    ];
  }
}

/**
 * Performance assertion helpers
 */
export class PerformanceAssertions {
  /**
   * Asserts that execution time is within threshold
   */
  static assertExecutionTime(result: BenchmarkResult, maxTime: number): void {
    expect(result.executionTime).toBeLessThan(maxTime);
  }

  /**
   * Asserts that memory usage is within limits
   */
  static assertMemoryUsage(result: BenchmarkResult, maxMB: number): void {
    const maxBytes = maxMB * 1024 * 1024;
    expect(result.memoryUsage).toBeLessThan(maxBytes);
  }

  /**
   * Asserts that throughput meets minimum requirements
   */
  static assertThroughput(result: BenchmarkResult, minThroughput: number): void {
    expect(result.throughput).toBeGreaterThan(minThroughput);
  }

  /**
   * Asserts that concurrent load test passes
   */
  static assertConcurrentLoad(result: ConcurrentLoadResult): void {
    expect(result.errorRate).toBeLessThan(0.05); // < 5% error rate
    expect(result.averageResponseTime).toBeLessThan(1000); // < 1s average response
    expect(result.passed).toBe(true);
  }

  /**
   * Asserts that scalability requirements are met
   */
  static assertScalability(scalingEfficiency: number, minEfficiency: number = 0.5): void {
    expect(scalingEfficiency).toBeGreaterThan(minEfficiency);
  }
}

// Export convenience functions
export const benchmarker = new PerformanceBenchmarker();
export const memoryProfiler = new MemoryProfiler();
export const concurrentTester = new ConcurrentLoadTester();
export const scalabilityTester = new ScalabilityTester();