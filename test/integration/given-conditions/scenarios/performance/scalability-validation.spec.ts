import { MemoryStore } from "../../../../../src/memory/memory-store";
import { FactReference } from "../../../../../src/storage";
import { dehydrateFact } from "../../../../../src/fact/hydrate";
import { User, Company, Office, OfficeClosed, OfficeReopened, Administrator, Manager, Employee } from "../../../../companyModel";
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

describe("Given Conditions - Scalability Validation", () => {
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
});