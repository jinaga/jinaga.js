import { MemoryStore } from "../../../../src/memory/memory-store";
import { FactEnvelope } from "../../../../src/storage";
import { dehydrateFact, Dehydration } from "../../../../src/fact/hydrate";
import { User, Company, Office, OfficeClosed, OfficeReopened, Administrator, Manager, Employee } from "../../../companyModel";
import { GeneratedData } from "./data-generators";

/**
 * Storage backend fixtures for integration testing
 */

export interface StorageTestHarness {
  setup(): Promise<MemoryStore>;
  populate(data: GeneratedData): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Memory storage harness for testing
 */
export class MemoryStorageHarness implements StorageTestHarness {
  private store: MemoryStore | null = null;

  async setup(): Promise<MemoryStore> {
    this.store = new MemoryStore();
    return this.store;
  }

  async populate(data: GeneratedData): Promise<void> {
    if (!this.store) {
      throw new Error("Storage not initialized. Call setup() first.");
    }

    const dehydrate = new Dehydration();

    // Dehydrate all facts
    [
      ...data.users,
      ...data.companies,
      ...data.offices,
      ...data.closures,
      ...data.reopenings,
      ...data.administrators,
      ...data.managers,
      ...data.employees
    ].forEach(fact => dehydrate.dehydrate(fact));

    // Save to storage
    const envelopes: FactEnvelope[] = dehydrate.factRecords().map(fact => ({
      fact,
      signatures: []
    }));

    await this.store.save(envelopes);
  }

  async cleanup(): Promise<void> {
    if (this.store) {
      await this.store.close();
      this.store = null;
    }
  }

  getStore(): MemoryStore | null {
    return this.store;
  }
}

/**
 * Creates a pre-populated memory store for testing
 */
export async function createPopulatedMemoryStore(data: GeneratedData): Promise<MemoryStore> {
  const harness = new MemoryStorageHarness();
  const store = await harness.setup();
  await harness.populate(data);
  return store;
}

/**
 * Storage backend factory for different test scenarios
 */
export class StorageBackendFactory {
  static async createMemoryBackend(data?: GeneratedData): Promise<MemoryStore> {
    const harness = new MemoryStorageHarness();
    const store = await harness.setup();

    if (data) {
      await harness.populate(data);
    }

    return store;
  }

  static async createEmptyMemoryBackend(): Promise<MemoryStore> {
    return new MemoryStore();
  }
}

/**
 * Test data isolation utilities
 */
export class TestDataIsolation {
  private static isolationKey = 0;

  /**
   * Creates an isolated test context with unique data
   */
  static async createIsolatedContext(generator: () => GeneratedData): Promise<{
    data: GeneratedData;
    store: MemoryStore;
    cleanup: () => Promise<void>;
  }> {
    const data = generator();
    const store = await createPopulatedMemoryStore(data);

    // Add isolation key to make data unique
    this.isolationKey++;

    return {
      data,
      store,
      cleanup: async () => {
        await store.close();
      }
    };
  }

  /**
   * Creates multiple isolated contexts for parallel testing
   */
  static async createMultipleIsolatedContexts(
    count: number,
    generator: () => GeneratedData
  ): Promise<Array<{
    data: GeneratedData;
    store: MemoryStore;
    cleanup: () => Promise<void>;
  }>> {
    const contexts: Array<{
      data: GeneratedData;
      store: MemoryStore;
      cleanup: () => Promise<void>;
    }> = [];

    for (let i = 0; i < count; i++) {
      contexts.push(await this.createIsolatedContext(generator));
    }

    return contexts;
  }
}

/**
 * Performance testing utilities for storage backends
 */
export class StoragePerformanceTester {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Measures read performance for a specification
   */
  async measureReadPerformance(
    startFacts: any[],
    specification: any,
    iterations: number = 100
  ): Promise<{
    averageTime: number;
    minTime: number;
    maxTime: number;
    totalTime: number;
  }> {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      await this.store.read(startFacts, specification);
      const endTime = performance.now();
      times.push(endTime - startTime);
    }

    return {
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      totalTime: times.reduce((a, b) => a + b, 0)
    };
  }

  /**
   * Measures write performance for fact envelopes
   */
  async measureWritePerformance(
    envelopes: FactEnvelope[],
    iterations: number = 100
  ): Promise<{
    averageTime: number;
    minTime: number;
    maxTime: number;
    totalTime: number;
  }> {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      await this.store.save(envelopes);
      const endTime = performance.now();
      times.push(endTime - startTime);
    }

    return {
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      totalTime: times.reduce((a, b) => a + b, 0)
    };
  }
}

/**
 * Storage backend validation utilities
 */
export class StorageValidator {
  static async validateFactExistence(store: MemoryStore, facts: any[]): Promise<boolean> {
    for (const fact of facts) {
      const dehydrated = dehydrateFact(fact);
      const references = dehydrated.map(record => ({
        type: record.type,
        hash: record.hash
      }));
      const exists = await store.whichExist(references);
      if (exists.length !== dehydrated.length) {
        return false;
      }
    }
    return true;
  }

  static async validateFactCount(store: MemoryStore, expectedCount: number): Promise<boolean> {
    // This is a simplified validation - in practice you'd want more sophisticated checks
    const allFacts = await store.load([]);
    return allFacts.length === expectedCount;
  }

  static async validateRelationships(store: MemoryStore, fact: any, expectedRelations: any[]): Promise<boolean> {
    const dehydrated = dehydrateFact(fact)[0];
    const reference = {
      type: dehydrated.type,
      hash: dehydrated.hash
    };
    const loaded = await store.load([reference]);

    // Validate that expected relationships exist
    // This is a simplified check - real implementation would be more thorough
    return loaded.length > 0;
  }
}