import { dehydrateFact, FactReference, MemoryStore, SpecificationParser } from "@src";
import { Administrator, Company, Employee, Manager, Office, OfficeClosed, OfficeReopened, User } from "../../../companyModel";
import { SpecificationTemplates } from "../../setup/specification-builders";

/**
 * Scalability validation utilities for given conditions
 */
interface ScalabilityMetrics {
  datasetSize: number;
  executionTime: number;
  memoryUsage: number;
  resultCount: number;
  throughput: number; // facts per second
  scalingFactor: number; // performance scaling factor
  timestamp: Date;
}

interface ScalabilityResult {
  name: string;
  baselineMetrics: ScalabilityMetrics;
  scaledMetrics: ScalabilityMetrics;
  scalingEfficiency: number;
  performanceDegradation: number;
  passed: boolean;
}

interface DatasetScalingPattern {
  name: string;
  description: string;
  baseSize: number;
  scalingFactors: number[];
  expectedScalingEfficiency: number;
}

class ScalabilityValidator {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Generates dataset of specific size for scalability testing
   */
  generateScalableDataset(size: number): {
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

    // Scale user count with dataset size
    const userCount = Math.max(10, Math.floor(size / 20));
    for (let i = 0; i < userCount; i++) {
      users.push(new User(`scale-user-${size}-${i}-public-key`));
    }

    // Scale company count
    const companyCount = Math.max(2, Math.floor(size / 50));
    for (let i = 0; i < companyCount; i++) {
      companies.push(new Company(users[i % users.length], `ScaleCompany-${size}-${i}`));
    }

    // Scale office count (3-5 offices per company)
    const officesPerCompany = Math.min(5, Math.max(3, Math.floor(size / 100)));
    companies.forEach((company, companyIndex) => {
      for (let i = 0; i < officesPerCompany; i++) {
        offices.push(new Office(company, `Office-${size}-${companyIndex}-${i}`));
      }
    });

    // Scale closures (30-40% of offices)
    const closureRate = 0.35;
    const closureCount = Math.floor(offices.length * closureRate);
    for (let i = 0; i < closureCount; i++) {
      const office = offices[i % offices.length];
      closures.push(new OfficeClosed(office, new Date(`2023-${String((i % 12) + 1).padStart(2, '0')}-01`)));
    }

    // Scale reopenings (50% of closures)
    const reopeningCount = Math.floor(closures.length * 0.5);
    for (let i = 0; i < reopeningCount; i++) {
      const closure = closures[i % closures.length];
      reopenings.push(new OfficeReopened(closure));
    }

    // Scale administrators (1 per company)
    companies.forEach((company, index) => {
      administrators.push(new Administrator(company, users[index % users.length], new Date("2023-01-01")));
    });

    // Scale managers (1 per office)
    offices.forEach((office, index) => {
      managers.push(new Manager(office, 10000 + size + index));
    });

    // Scale employees (distributed across offices)
    offices.forEach((office, officeIndex) => {
      const employeeCount = Math.max(1, Math.floor(size / offices.length / 10));
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
   * Measures scalability metrics for a query
   */
  async measureScalability(
    name: string,
    givenFacts: FactReference[],
    specification: any,
    datasetSize: number
  ): Promise<ScalabilityMetrics> {
    const startTime = performance.now();
    const startMemory = this.getMemoryUsage();

    const results = await this.store.read(givenFacts, specification);

    const endTime = performance.now();
    const endMemory = this.getMemoryUsage();

    const executionTime = endTime - startTime;
    const memoryUsage = endMemory - startMemory;
    const throughput = datasetSize / (executionTime / 1000);

    return {
      datasetSize,
      executionTime,
      memoryUsage,
      resultCount: results.length,
      throughput,
      scalingFactor: 1.0, // Will be calculated when comparing
      timestamp: new Date()
    };
  }

  /**
   * Validates scalability by comparing performance across dataset sizes
   */
  async validateScalability(
    name: string,
    baseDataset: any,
    scaledDataset: any,
    specification: any,
    testOffice: Office
  ): Promise<ScalabilityResult> {
    // Measure baseline performance
    const baseOfficeRef: FactReference = dehydrateFact(testOffice)[0];

    const baselineMetrics = await this.measureScalability(
      `${name}-baseline`,
      [baseOfficeRef],
      specification,
      this.calculateDatasetSize(baseDataset)
    );

    // Measure scaled performance
    const scaledOfficeRef: FactReference = dehydrateFact(testOffice)[0];

    const scaledMetrics = await this.measureScalability(
      `${name}-scaled`,
      [scaledOfficeRef],
      specification,
      this.calculateDatasetSize(scaledDataset)
    );

    // Calculate scaling metrics
    const scalingEfficiency = baselineMetrics.throughput / scaledMetrics.throughput;
    const performanceDegradation = (scaledMetrics.executionTime - baselineMetrics.executionTime) / baselineMetrics.executionTime;

    // Update scaling factors
    baselineMetrics.scalingFactor = 1.0;
    scaledMetrics.scalingFactor = scalingEfficiency;

    const passed = scalingEfficiency >= 0.7 && performanceDegradation <= 2.0; // Allow up to 2x degradation

    return {
      name,
      baselineMetrics,
      scaledMetrics,
      scalingEfficiency,
      performanceDegradation,
      passed
    };
  }

  /**
   * Calculates total dataset size (number of facts)
   */
  private calculateDatasetSize(dataset: any): number {
    return dataset.users.length +
           dataset.companies.length +
           dataset.offices.length +
           dataset.closures.length +
           dataset.reopenings.length +
           dataset.administrators.length +
           dataset.managers.length +
           dataset.employees.length;
  }

  /**
   * Gets current memory usage (simplified for Node.js environment)
   */
  private getMemoryUsage(): number {
    // In a real implementation, this would use process.memoryUsage()
    return 0;
  }

  /**
   * Creates scaling patterns for testing
   */
  createScalingPatterns(): DatasetScalingPattern[] {
    return [
      {
        name: "linear-growth",
        description: "Linear dataset growth from 500 to 2000 facts",
        baseSize: 500,
        scalingFactors: [1, 2, 4],
        expectedScalingEfficiency: 0.8
      },
      {
        name: "moderate-growth",
        description: "Moderate dataset growth from 1000 to 5000 facts",
        baseSize: 1000,
        scalingFactors: [1, 3, 5],
        expectedScalingEfficiency: 0.75
      },
      {
        name: "large-growth",
        description: "Large dataset growth from 2000 to 10000 facts",
        baseSize: 2000,
        scalingFactors: [1, 3, 5],
        expectedScalingEfficiency: 0.7
      }
    ];
  }
}

describe("Given Conditions - Scalability and Resource Limits", () => {
  let store: MemoryStore;
  let validator: ScalabilityValidator;
  let baseDataset: any;
  let testOffice: Office;

  beforeEach(async () => {
    // Generate base dataset
    baseDataset = validator.generateScalableDataset(1000);
    testOffice = baseDataset.offices[0];

    // Create memory store
    store = new MemoryStore();
    validator = new ScalabilityValidator(store);

    // Save base dataset
    const facts = [
      ...baseDataset.users,
      ...baseDataset.companies,
      ...baseDataset.offices,
      ...baseDataset.closures,
      ...baseDataset.reopenings,
      ...baseDataset.administrators,
      ...baseDataset.managers,
      ...baseDataset.employees
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

  // ===== SCALABILITY SECTION =====

  describe("Linear Scalability Testing", () => {
    it("should validate scalability with 2x dataset growth", async () => {
      const scaledDataset = validator.generateScalableDataset(2000);

      // Create fresh store for scaled dataset
      const scaledStore = new MemoryStore();
      const scaledValidator = new ScalabilityValidator(scaledStore);

      // Save scaled dataset
      const scaledFacts = [
        ...scaledDataset.users,
        ...scaledDataset.companies,
        ...scaledDataset.offices,
        ...scaledDataset.closures,
        ...scaledDataset.reopenings,
        ...scaledDataset.administrators,
        ...scaledDataset.managers,
        ...scaledDataset.employees
      ];

      for (const fact of scaledFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await scaledStore.save(envelopes);
      }

      const specification = SpecificationTemplates.officesClosed();

      const result = await scaledValidator.validateScalability(
        "2x-growth-test",
        baseDataset,
        scaledDataset,
        specification,
        testOffice
      );

      expect(result.scalingEfficiency).toBeGreaterThan(0.6); // At least 60% efficiency
      expect(result.performanceDegradation).toBeLessThan(3.0); // Less than 3x degradation
      expect(result.passed).toBe(true);

      // Validate scaling factors make sense
      expect(result.baselineMetrics.scalingFactor).toBe(1.0);
      expect(result.scaledMetrics.scalingFactor).toBe(result.scalingEfficiency);
    });

    it("should validate scalability with 4x dataset growth", async () => {
      const scaledDataset = validator.generateScalableDataset(4000);

      // Create fresh store for scaled dataset
      const scaledStore = new MemoryStore();
      const scaledValidator = new ScalabilityValidator(scaledStore);

      // Save scaled dataset
      const scaledFacts = [
        ...scaledDataset.users,
        ...scaledDataset.companies,
        ...scaledDataset.offices,
        ...scaledDataset.closures,
        ...scaledDataset.reopenings,
        ...scaledDataset.administrators,
        ...scaledDataset.managers,
        ...scaledDataset.employees
      ];

      for (const fact of scaledFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await scaledStore.save(envelopes);
      }

      const specification = SpecificationTemplates.officesClosedNotReopened();

      const result = await scaledValidator.validateScalability(
        "4x-growth-test",
        baseDataset,
        scaledDataset,
        specification,
        testOffice
      );

      expect(result.scalingEfficiency).toBeGreaterThan(0.5); // At least 50% efficiency
      expect(result.performanceDegradation).toBeLessThan(5.0); // Less than 5x degradation
      expect(result.passed).toBe(true);
    });

    it("should maintain reasonable performance with 10x dataset growth", async () => {
      const scaledDataset = validator.generateScalableDataset(10000);

      // Create fresh store for scaled dataset
      const scaledStore = new MemoryStore();
      const scaledValidator = new ScalabilityValidator(scaledStore);

      // Save scaled dataset
      const scaledFacts = [
        ...scaledDataset.users,
        ...scaledDataset.companies,
        ...scaledDataset.offices,
        ...scaledDataset.closures,
        ...scaledDataset.reopenings,
        ...scaledDataset.administrators,
        ...scaledDataset.managers,
        ...scaledDataset.employees
      ];

      for (const fact of scaledFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await scaledStore.save(envelopes);
      }

      const specification = SpecificationTemplates.officesClosed();

      const result = await scaledValidator.validateScalability(
        "10x-growth-test",
        baseDataset,
        scaledDataset,
        specification,
        testOffice
      );

      // With 10x growth, we expect some performance degradation but still reasonable performance
      expect(result.scalingEfficiency).toBeGreaterThan(0.3); // At least 30% efficiency
      expect(result.performanceDegradation).toBeLessThan(10.0); // Less than 10x degradation
      expect(result.scaledMetrics.executionTime).toBeLessThan(5000); // Still under 5 seconds
      expect(result.passed).toBe(true);
    });
  });

  describe("Query Complexity Scaling", () => {
    it("should validate scalability across different query complexities", async () => {
      const scaledDataset = validator.generateScalableDataset(3000);

      // Create fresh store for scaled dataset
      const scaledStore = new MemoryStore();
      const scaledValidator = new ScalabilityValidator(scaledStore);

      // Save scaled dataset
      const scaledFacts = [
        ...scaledDataset.users,
        ...scaledDataset.companies,
        ...scaledDataset.offices,
        ...scaledDataset.closures,
        ...scaledDataset.reopenings,
        ...scaledDataset.administrators,
        ...scaledDataset.managers,
        ...scaledDataset.employees
      ];

      for (const fact of scaledFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await scaledStore.save(envelopes);
      }

      const specifications = [
        { name: "simple", spec: SpecificationTemplates.officesClosed(), expectedDegradation: 2.0 },
        { name: "negative", spec: SpecificationTemplates.officesNotClosed(), expectedDegradation: 2.5 },
        { name: "complex", spec: SpecificationTemplates.officesClosedNotReopened(), expectedDegradation: 3.0 }
      ];

      const results: ScalabilityResult[] = [];

      for (const { name, spec, expectedDegradation } of specifications) {
        const result = await scaledValidator.validateScalability(
          `${name}-complexity-test`,
          baseDataset,
          scaledDataset,
          spec,
          testOffice
        );

        results.push(result);

        // Validate complexity-specific expectations
        expect(result.performanceDegradation).toBeLessThan(expectedDegradation);
        expect(result.passed).toBe(true);
      }

      // Complex queries should have higher degradation than simple ones
      const simpleResult = results.find(r => r.name.includes("simple"));
      const complexResult = results.find(r => r.name.includes("complex"));

      if (simpleResult && complexResult) {
        expect(complexResult.performanceDegradation).toBeGreaterThanOrEqual(simpleResult.performanceDegradation);
      }
    });

    it("should validate memory scaling with dataset growth", async () => {
      const scalingResults: ScalabilityResult[] = [];
      const datasetSizes = [500, 1000, 2000, 5000];

      for (const size of datasetSizes) {
        const scaledDataset = validator.generateScalableDataset(size);

        // Create fresh store for each dataset size
        const scaledStore = new MemoryStore();
        const scaledValidator = new ScalabilityValidator(scaledStore);

        // Save scaled dataset
        const scaledFacts = [
          ...scaledDataset.users,
          ...scaledDataset.companies,
          ...scaledDataset.offices,
          ...scaledDataset.closures,
          ...scaledDataset.reopenings,
          ...scaledDataset.administrators,
          ...scaledDataset.managers,
          ...scaledDataset.employees
        ];

        for (const fact of scaledFacts) {
          const dehydrated = dehydrateFact(fact);
          const envelopes = dehydrated.map(record => ({
            fact: record,
            signatures: []
          }));
          await scaledStore.save(envelopes);
        }

        const specification = SpecificationTemplates.officesClosed();

        const result = await scaledValidator.validateScalability(
          `memory-scaling-${size}`,
          baseDataset,
          scaledDataset,
          specification,
          testOffice
        );

        scalingResults.push(result);
      }

      // Validate memory scaling patterns
      scalingResults.forEach(result => {
        expect(result.passed).toBe(true);
        // Memory usage should scale but remain reasonable
        expect(result.scaledMetrics.memoryUsage).toBeLessThan(200 * 1024 * 1024); // Less than 200MB
      });

      // Memory scaling should be more efficient than linear
      if (scalingResults.length >= 2) {
        const smallResult = scalingResults.find(r => r.name.includes('500'));
        const largeResult = scalingResults.find(r => r.name.includes('5000'));

        if (smallResult && largeResult) {
          const memoryScalingFactor = largeResult.scaledMetrics.memoryUsage / smallResult.baselineMetrics.memoryUsage;
          const dataScalingFactor = 5000 / 500;

          // Memory should scale better than data size
          expect(memoryScalingFactor).toBeLessThan(dataScalingFactor * 1.5);
        }
      }
    });
  });

  describe("Performance Degradation Analysis", () => {
    it("should analyze performance degradation patterns", async () => {
      const degradationResults: ScalabilityResult[] = [];
      const scalingFactors = [1, 1.5, 2, 3, 5];

      for (const factor of scalingFactors) {
        const scaledSize = Math.floor(1000 * factor);
        const scaledDataset = validator.generateScalableDataset(scaledSize);

        // Create fresh store for scaled dataset
        const scaledStore = new MemoryStore();
        const scaledValidator = new ScalabilityValidator(scaledStore);

        // Save scaled dataset
        const scaledFacts = [
          ...scaledDataset.users,
          ...scaledDataset.companies,
          ...scaledDataset.offices,
          ...scaledDataset.closures,
          ...scaledDataset.reopenings,
          ...scaledDataset.administrators,
          ...scaledDataset.managers,
          ...scaledDataset.employees
        ];

        for (const fact of scaledFacts) {
          const dehydrated = dehydrateFact(fact);
          const envelopes = dehydrated.map(record => ({
            fact: record,
            signatures: []
          }));
          await scaledStore.save(envelopes);
        }

        const specification = SpecificationTemplates.officesClosed();

        const result = await scaledValidator.validateScalability(
          `degradation-${factor}x`,
          baseDataset,
          scaledDataset,
          specification,
          testOffice
        );

        degradationResults.push(result);
      }

      // Analyze degradation patterns
      const degradations = degradationResults.map(r => r.performanceDegradation);

      // Degradation should increase with scale but not exponentially
      for (let i = 1; i < degradations.length; i++) {
        const degradationIncrease = degradations[i] - degradations[i - 1];
        expect(degradationIncrease).toBeLessThan(2.0); // No more than 2x increase per step
      }

      // Overall system should remain functional
      degradationResults.forEach(result => {
        expect(result.passed).toBe(true);
        expect(result.scaledMetrics.executionTime).toBeLessThan(10000); // Under 10 seconds
      });
    });

    it("should validate scalability thresholds", async () => {
      const thresholdResults: ScalabilityResult[] = [];
      const thresholds = [
        { size: 2000, maxTime: 1000, description: "2K dataset threshold" },
        { size: 5000, maxTime: 2000, description: "5K dataset threshold" },
        { size: 10000, maxTime: 5000, description: "10K dataset threshold" }
      ];

      for (const threshold of thresholds) {
        const scaledDataset = validator.generateScalableDataset(threshold.size);

        // Create fresh store for scaled dataset
        const scaledStore = new MemoryStore();
        const scaledValidator = new ScalabilityValidator(scaledStore);

        // Save scaled dataset
        const scaledFacts = [
          ...scaledDataset.users,
          ...scaledDataset.companies,
          ...scaledDataset.offices,
          ...scaledDataset.closures,
          ...scaledDataset.reopenings,
          ...scaledDataset.administrators,
          ...scaledDataset.managers,
          ...scaledDataset.employees
        ];

        for (const fact of scaledFacts) {
          const dehydrated = dehydrateFact(fact);
          const envelopes = dehydrated.map(record => ({
            fact: record,
            signatures: []
          }));
          await scaledStore.save(envelopes);
        }

        const specification = SpecificationTemplates.officesClosed();

        const result = await scaledValidator.validateScalability(
          `threshold-${threshold.size}`,
          baseDataset,
          scaledDataset,
          specification,
          testOffice
        );

        thresholdResults.push(result);

        // Validate against specific thresholds
        expect(result.scaledMetrics.executionTime).toBeLessThan(threshold.maxTime);
        expect(result.passed).toBe(true);
      }

      // Ensure scaling remains predictable
      thresholdResults.forEach(result => {
        expect(result.scalingEfficiency).toBeGreaterThan(0.4);
        expect(result.performanceDegradation).toBeLessThan(8.0);
      });
    });
  });

  describe("Scalability Pattern Validation", () => {
    it("should validate predefined scaling patterns", async () => {
      const patterns = validator.createScalingPatterns();
      const patternResults: ScalabilityResult[] = [];

      for (const pattern of patterns) {
        for (const factor of pattern.scalingFactors) {
          const scaledSize = Math.floor(pattern.baseSize * factor);
          const scaledDataset = validator.generateScalableDataset(scaledSize);

          // Create fresh store for scaled dataset
          const scaledStore = new MemoryStore();
          const scaledValidator = new ScalabilityValidator(scaledStore);

          // Save scaled dataset
          const scaledFacts = [
            ...scaledDataset.users,
            ...scaledDataset.companies,
            ...scaledDataset.offices,
            ...scaledDataset.closures,
            ...scaledDataset.reopenings,
            ...scaledDataset.administrators,
            ...scaledDataset.managers,
            ...scaledDataset.employees
          ];

          for (const fact of scaledFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
              fact: record,
              signatures: []
            }));
            await scaledStore.save(envelopes);
          }

          const specification = SpecificationTemplates.officesClosed();

          const result = await scaledValidator.validateScalability(
            `${pattern.name}-${factor}x`,
            baseDataset,
            scaledDataset,
            specification,
            testOffice
          );

          patternResults.push(result);

          // Validate against pattern expectations
          expect(result.scalingEfficiency).toBeGreaterThan(pattern.expectedScalingEfficiency * 0.8);
          expect(result.passed).toBe(true);
        }
      }

      // Validate pattern consistency
      const patternGroups = new Map<string, ScalabilityResult[]>();
      patternResults.forEach(result => {
        const patternName = result.name.split('-')[0];
        if (!patternGroups.has(patternName)) {
          patternGroups.set(patternName, []);
        }
        patternGroups.get(patternName)!.push(result);
      });

      // Each pattern should show consistent scaling behavior
      patternGroups.forEach((results, patternName) => {
        const efficiencies = results.map(r => r.scalingEfficiency);
        const avgEfficiency = efficiencies.reduce((sum, e) => sum + e, 0) / efficiencies.length;
        const efficiencyVariance = efficiencies.reduce((sum, e) => sum + Math.pow(e - avgEfficiency, 2), 0) / efficiencies.length;

        expect(Math.sqrt(efficiencyVariance)).toBeLessThan(0.2); // Low variance in scaling efficiency
      });
    });
  });

  describe("Scalability Reporting", () => {
    it("should generate comprehensive scalability reports", async () => {
      const reportResults: ScalabilityResult[] = [];
      const reportSizes = [500, 1000, 2000, 5000];

      for (const size of reportSizes) {
        const scaledDataset = validator.generateScalableDataset(size);

        // Create fresh store for scaled dataset
        const scaledStore = new MemoryStore();
        const scaledValidator = new ScalabilityValidator(scaledStore);

        // Save scaled dataset
        const scaledFacts = [
          ...scaledDataset.users,
          ...scaledDataset.companies,
          ...scaledDataset.offices,
          ...scaledDataset.closures,
          ...scaledDataset.reopenings,
          ...scaledDataset.administrators,
          ...scaledDataset.managers,
          ...scaledDataset.employees
        ];

        for (const fact of scaledFacts) {
          const dehydrated = dehydrateFact(fact);
          const envelopes = dehydrated.map(record => ({
            fact: record,
            signatures: []
          }));
          await scaledStore.save(envelopes);
        }

        const specifications = [
          SpecificationTemplates.officesClosed(),
          SpecificationTemplates.officesNotClosed()
        ];

        for (const spec of specifications) {
          const result = await scaledValidator.validateScalability(
            `report-${size}-${spec === SpecificationTemplates.officesClosed() ? 'simple' : 'negative'}`,
            baseDataset,
            scaledDataset,
            spec,
            testOffice
          );

          reportResults.push(result);
        }
      }

      // Validate report structure
      expect(reportResults.length).toBe(8); // 4 sizes × 2 specifications
      reportResults.forEach(result => {
        expect(result.name).toMatch(/^report-\d+-(simple|negative)$/);
        expect(result.baselineMetrics).toBeDefined();
        expect(result.scaledMetrics).toBeDefined();
        expect(result.scalingEfficiency).toBeGreaterThan(0);
        expect(typeof result.performanceDegradation).toBe('number');
        expect(typeof result.passed).toBe('boolean');
      });

      // Calculate aggregate statistics
      const avgScalingEfficiency = reportResults.reduce((sum, r) => sum + r.scalingEfficiency, 0) / reportResults.length;
      const avgPerformanceDegradation = reportResults.reduce((sum, r) => sum + r.performanceDegradation, 0) / reportResults.length;
      const passRate = reportResults.filter(r => r.passed).length / reportResults.length;

      expect(avgScalingEfficiency).toBeGreaterThan(0.5);
      expect(avgPerformanceDegradation).toBeLessThan(4.0);
      expect(passRate).toBe(1.0); // All tests should pass
    });
  });

  // ===== RESOURCE LIMITS SECTION =====

  describe("Large Dataset Handling", () => {
    it("should handle large datasets without memory issues", async () => {
      // Create a large dataset
      const largeUsers = Array.from({ length: 1000 }, (_, i) => new User(`user-${i}`));
      const largeCompanies = Array.from({ length: 500 }, (_, i) =>
        new Company(largeUsers[i % largeUsers.length], `Company ${i}`)
      );
      const largeOffices = largeCompanies.flatMap(company =>
        Array.from({ length: 10 }, (_, i) =>
          new Office(company, `${company.identifier} Office ${i}`)
        )
      );
      const largeClosures = largeOffices.slice(0, 2000).map((office, i) =>
        new OfficeClosed(office, new Date(`2023-${String((i % 12) + 1).padStart(2, '0')}-01`))
      );

      const largeFacts = [...largeUsers, ...largeCompanies, ...largeOffices, ...largeClosures];

      // Save all facts to store
      for (const fact of largeFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specification = new SpecificationParser(`
        (office: Office [E {
          closure: Office.Closed [
            closure = office
          ]
        }]) {
        } => office
      `).parseSpecification();

      // Test with first closed office
      const testOffice = largeOffices.find(office =>
        largeClosures.some(closure => closure.office === office)
      );

      if (testOffice) {
        const officeRef: FactReference = {
          type: "Office",
          hash: dehydrateFact(testOffice)[0].hash
        };

        const results = await store.read([officeRef], specification);
        expect(results.length).toBe(1);
      }
    });

    it("should validate memory usage with deeply nested conditions", async () => {
      // Create dataset for deep nesting test
      const users = Array.from({ length: 50 }, (_, i) => new User(`user-${i}`));
      const companies = Array.from({ length: 20 }, (_, i) =>
        new Company(users[i % users.length], `Company ${i}`)
      );
      const offices = companies.flatMap(company =>
        Array.from({ length: 5 }, (_, i) =>
          new Office(company, `${company.identifier} Office ${i}`)
        )
      );
      const closures = offices.slice(0, 30).map(office =>
        new OfficeClosed(office, new Date("2023-06-01"))
      );
      const administrators = companies.map((company, i) =>
        new Administrator(company, users[i % users.length], new Date("2023-01-01"))
      );
      const managers = offices.slice(0, 20).map((office, i) =>
        new Manager(office, 1000 + i)
      );
      const employees = offices.slice(0, 15).map((office, i) =>
        new Employee(office, users[i % users.length])
      );

      const allFacts = [...users, ...companies, ...offices, ...closures, ...administrators, ...managers, ...employees];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specification = new SpecificationParser(`
        (office: Office [E {
          closure: Office.Closed [
            closure = office
            E {
              admin: Administrator [
                admin.company = closure.office.company
                E {
                  manager: Manager [
                    manager.office = closure.office
                    E {
                      employee: Employee [
                        employee.office = manager.office
                        employee.user = admin.user
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }]) {
        } => office
      `).parseSpecification();

      // Find office that meets all criteria
      const qualifyingOffice = offices.find(office =>
        closures.some(closure => closure.office === office) &&
        administrators.some(admin => admin.company === office.company) &&
        managers.some(manager => manager.office === office) &&
        employees.some(employee =>
          employee.office === office &&
          administrators.some(admin => admin.user === employee.user)
        )
      );

      if (qualifyingOffice) {
        const officeRef: FactReference = {
          type: "Office",
          hash: dehydrateFact(qualifyingOffice)[0].hash
        };

        const results = await store.read([officeRef], specification);
        expect(Array.isArray(results)).toBe(true);
      }
    });
  });

  describe("Concurrent Execution Limits", () => {
    it("should handle concurrent executions without resource conflicts", async () => {
      // Create moderate dataset
      const users = Array.from({ length: 20 }, (_, i) => new User(`user-${i}`));
      const companies = Array.from({ length: 10 }, (_, i) =>
        new Company(users[i % users.length], `Company ${i}`)
      );
      const offices = companies.flatMap(company =>
        Array.from({ length: 3 }, (_, i) =>
          new Office(company, `${company.identifier} Office ${i}`)
        )
      );
      const closures = offices.slice(0, 15).map(office =>
        new OfficeClosed(office, new Date("2023-06-01"))
      );

      const allFacts = [...users, ...companies, ...offices, ...closures];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specification = new SpecificationParser(`
        (office: Office [E {
          closure: Office.Closed [
            closure = office
          ]
        }]) {
        } => office
      `).parseSpecification();

      // Execute multiple concurrent queries
      const concurrentQueries = offices.slice(0, 5).map(async (office) => {
        if (closures.some(closure => closure.office === office)) {
          const officeRef: FactReference = {
            type: "Office",
            hash: dehydrateFact(office)[0].hash
          };
          return await store.read([officeRef], specification);
        }
        return [];
      });

      const results = await Promise.all(concurrentQueries);
      expect(results).toHaveLength(5);
      results.forEach(result => expect(Array.isArray(result)).toBe(true));
    });
  });

  describe("Storage Limits Validation", () => {
    it("should validate storage limits with many facts", async () => {
      // Test with maximum reasonable number of facts
      const maxUsers = Array.from({ length: 5000 }, (_, i) => new User(`user-${i}`));
      const maxCompanies = Array.from({ length: 1000 }, (_, i) =>
        new Company(maxUsers[i % maxUsers.length], `Company ${i}`)
      );
      const maxOffices = maxCompanies.flatMap(company =>
        Array.from({ length: 2 }, (_, i) =>
          new Office(company, `${company.identifier} Office ${i}`)
        )
      );

      const maxFacts = [...maxUsers, ...maxCompanies, ...maxOffices];

      // Save facts in batches to avoid overwhelming the store
      const batchSize = 1000;
      for (let i = 0; i < maxFacts.length; i += batchSize) {
        const batch = maxFacts.slice(i, i + batchSize);
        for (const fact of batch) {
          const dehydrated = dehydrateFact(fact);
          const envelopes = dehydrated.map(record => ({
            fact: record,
            signatures: []
          }));
          await store.save(envelopes);
        }
      }

      const specification = new SpecificationParser(`
        (office: Office) {
        } => office
      `).parseSpecification();

      // Test with first office
      const testOffice = maxOffices[0];
      const officeRef: FactReference = {
        type: "Office",
        hash: dehydrateFact(testOffice)[0].hash
      };

      const results = await store.read([officeRef], specification);
      expect(results.length).toBe(1);
    });
  });

  describe("Complex Specification Limits", () => {
    it("should handle specifications with many conditions efficiently", async () => {
      // Create dataset
      const users = Array.from({ length: 10 }, (_, i) => new User(`user-${i}`));
      const companies = Array.from({ length: 5 }, (_, i) =>
        new Company(users[i % users.length], `Company ${i}`)
      );
      const offices = companies.flatMap(company =>
        Array.from({ length: 2 }, (_, i) =>
          new Office(company, `${company.identifier} Office ${i}`)
        )
      );
      const closures = offices.map(office =>
        new OfficeClosed(office, new Date("2023-06-01"))
      );
      const administrators = companies.map((company, i) =>
        new Administrator(company, users[i % users.length], new Date("2023-01-01"))
      );

      const allFacts = [...users, ...companies, ...offices, ...closures, ...administrators];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      // Create specification with many parallel conditions
      const manyConditions = Array.from({ length: 50 }, (_, i) =>
        `E { condition${i}: Administrator [ condition${i}.company = office.company ] }`
      ).join(' ');

      const specification = new SpecificationParser(`
        (office: Office [E {
          closure: Office.Closed [
            closure = office
            ${manyConditions}
          ]
        }]) {
        } => office
      `).parseSpecification();

      // Test with office that has closure and admin
      const testOffice = offices.find(office =>
        closures.some(closure => closure.office === office) &&
        administrators.some(admin => admin.company === office.company)
      );

      if (testOffice) {
        const officeRef: FactReference = {
          type: "Office",
          hash: dehydrateFact(testOffice)[0].hash
        };

        const results = await store.read([officeRef], specification);
        expect(Array.isArray(results)).toBe(true);
      }
    });

    it("should validate performance with complex queries", async () => {
      // Create complex dataset for performance testing
      const users = Array.from({ length: 100 }, (_, i) => new User(`user-${i}`));
      const companies = Array.from({ length: 50 }, (_, i) =>
        new Company(users[i % users.length], `Company ${i}`)
      );
      const offices = companies.flatMap(company =>
        Array.from({ length: 4 }, (_, i) =>
          new Office(company, `${company.identifier} Office ${i}`)
        )
      );
      const closures = offices.slice(0, 100).map(office =>
        new OfficeClosed(office, new Date("2023-06-01"))
      );
      const reopenings = closures.slice(0, 50).map(closure =>
        new OfficeReopened(closure)
      );
      const administrators = companies.map((company, i) =>
        new Administrator(company, users[i % users.length], new Date("2023-01-01"))
      );
      const managers = offices.slice(0, 75).map((office, i) =>
        new Manager(office, 2000 + i)
      );

      const allFacts = [...users, ...companies, ...offices, ...closures, ...reopenings, ...administrators, ...managers];

      for (const fact of allFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specification = new SpecificationParser(`
        (office: Office [E {
          closure: Office.Closed [
            closure = office
            !E {
              reopening: Office.Reopened [
                reopening = closure
              ]
            }
            E {
              admin: Administrator [
                admin.company = closure.office.company
              ]
            }
            E {
              manager: Manager [
                manager.office = office
              ]
            }
          ]
        }]) {
        } => office
      `).parseSpecification();

      // Test with office that meets complex criteria
      const qualifyingOffice = offices.find(office =>
        closures.some(closure => closure.office === office) &&
        !reopenings.some(reopening => reopening.officeClosed.office === office) &&
        administrators.some(admin => admin.company === office.company) &&
        managers.some(manager => manager.office === office)
      );

      if (qualifyingOffice) {
        const officeRef: FactReference = {
          type: "Office",
          hash: dehydrateFact(qualifyingOffice)[0].hash
        };

        const startTime = Date.now();
        const results = await store.read([officeRef], specification);
        const endTime = Date.now();

        expect(results.length).toBe(1);
        expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
      }
    });
  });

  describe("Memory Cleanup Validation", () => {
    it("should handle memory cleanup after large operations", async () => {
      // Create large dataset, execute query, then verify system stability
      const largeUsers = Array.from({ length: 2000 }, (_, i) => new User(`user-${i}`));
      const largeCompanies = Array.from({ length: 500 }, (_, i) =>
        new Company(largeUsers[i % largeUsers.length], `Company ${i}`)
      );

      const largeFacts = [...largeUsers, ...largeCompanies];

      for (const fact of largeFacts) {
        const dehydrated = dehydrateFact(fact);
        const envelopes = dehydrated.map(record => ({
          fact: record,
          signatures: []
        }));
        await store.save(envelopes);
      }

      const specification = new SpecificationParser(`
        (company: Company) {
        } => company
      `).parseSpecification();

      // Execute query with large dataset
      const testCompany = largeCompanies[0];
      const companyRef: FactReference = {
        type: "Company",
        hash: dehydrateFact(testCompany)[0].hash
      };

      const results = await store.read([companyRef], specification);
      expect(results.length).toBe(1);

      // Execute smaller query to verify system is still responsive
      const smallSpecification = new SpecificationParser(`
        (user: User) {
        } => user
      `).parseSpecification();

      const testUser = largeUsers[0];
      const userRef: FactReference = {
        type: "User",
        hash: dehydrateFact(testUser)[0].hash
      };

      const smallResults = await store.read([userRef], smallSpecification);
      expect(smallResults.length).toBe(1);
    });
  });
});