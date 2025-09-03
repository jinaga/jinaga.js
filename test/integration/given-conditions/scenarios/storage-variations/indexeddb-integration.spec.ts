import { IndexedDBStore } from "../../../../../src/indexeddb/indexeddb-store";
import { FactEnvelope, FactReference } from "../../../../../src/storage";
import { dehydrateFact, Dehydration } from "../../../../../src/fact/hydrate";
import { User, Company, Office, OfficeClosed, OfficeReopened, Administrator, Manager, Employee } from "../../../../companyModel";
import { GeneratedData, generateSmallCompanyNetwork, generateMediumCompanyNetwork } from "../../setup/data-generators";
import { SpecificationTemplates } from "../../setup/specification-builders";

/**
 * IndexedDB Integration Tests for Given Conditions
 *
 * Tests basic IndexedDB functionality with given conditions, ensuring
 * that the storage backend works correctly with real IndexedDB operations.
 */

export interface IndexedDBTestHarness {
  setup(): Promise<IndexedDBStore>;
  populate(data: GeneratedData): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * IndexedDB storage harness for testing
 */
export class IndexedDBStorageHarness implements IndexedDBTestHarness {
  private store: IndexedDBStore | null = null;
  private dbName: string;

  constructor(dbName?: string) {
    this.dbName = dbName || `test-db-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async setup(): Promise<IndexedDBStore> {
    this.store = new IndexedDBStore(this.dbName);
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

    // Clean up IndexedDB database
    if (typeof indexedDB !== 'undefined') {
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);
      await new Promise<void>((resolve, reject) => {
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onblocked = () => reject(new Error('Database deletion blocked'));
      });
    }
  }

  getStore(): IndexedDBStore | null {
    return this.store;
  }
}

describe("Given Conditions - IndexedDB Integration", () => {
  let harness: IndexedDBStorageHarness;
  let store: IndexedDBStore;
  let testData: GeneratedData;

  beforeEach(async () => {
    harness = new IndexedDBStorageHarness();
    store = await harness.setup();
    testData = generateSmallCompanyNetwork();
    await harness.populate(testData);
  }, 10000); // Increase timeout for IndexedDB operations

  afterEach(async () => {
    await harness.cleanup();
  }, 10000);

  describe("Basic IndexedDB Operations", () => {
    it("should save and retrieve facts from IndexedDB", async () => {
      const user = testData.users[0];
      const dehydrated = dehydrateFact(user);
      const reference = {
        type: dehydrated[0].type,
        hash: dehydrated[0].hash
      };

      const loaded = await store.load([reference]);
      expect(loaded.length).toBeGreaterThan(0);
      expect(loaded[0].fact.type).toBe("User");
    });

    it("should handle whichExist queries correctly", async () => {
      const user = testData.users[0];
      const dehydrated = dehydrateFact(user);
      const reference = {
        type: dehydrated[0].type,
        hash: dehydrated[0].hash
      };

      const existing = await store.whichExist([reference]);
      expect(existing.length).toBe(1);
      expect(existing[0]).toEqual(reference);
    });
  });

  describe("Given Conditions with IndexedDB", () => {
    it("should filter offices that have closure facts (positive existential)", async () => {
      const specification = SpecificationTemplates.officesClosed();

      // Find a closed office from test data
      const closedOffice = testData.offices.find(office =>
        testData.closures.some(closure => {
          const closureRecord = dehydrateFact(closure)[0];
          const officePredecessor = closureRecord.predecessors.office;
          const officeRef = Array.isArray(officePredecessor) ? officePredecessor[0] : officePredecessor;
          return officeRef.hash === dehydrateFact(office)[0].hash;
        })
      );

      if (!closedOffice) {
        throw new Error("No closed office found in test data");
      }

      const officeRef: FactReference = dehydrateFact(closedOffice)[0];

      const results = await store.read([officeRef], specification);

      // Should return only the closed office
      expect(results.length).toBe(1);
      expect(results[0].result.type).toBe("Office");
    });

    it("should not return offices without closure facts", async () => {
      const specification = SpecificationTemplates.officesClosed();

      // Find an open office (no closure)
      const openOffice = testData.offices.find(office =>
        !testData.closures.some(closure => {
          const closureRecord = dehydrateFact(closure)[0];
          const officePredecessor = closureRecord.predecessors.office;
          const officeRef = Array.isArray(officePredecessor) ? officePredecessor[0] : officePredecessor;
          return officeRef.hash === dehydrateFact(office)[0].hash;
        })
      );

      if (!openOffice) {
        throw new Error("No open office found in test data");
      }

      const officeRef: FactReference = dehydrateFact(openOffice)[0];

      const results = await store.read([officeRef], specification);

      // Should return empty result since office is not closed
      expect(results.length).toBe(0);
    });

    it("should handle multiple offices with mixed closure status", async () => {
      const specification = SpecificationTemplates.officesClosed();

      // Test with both closed and open offices
      const closedOffice = testData.offices.find(office =>
        testData.closures.some(closure => {
          const closureRecord = dehydrateFact(closure)[0];
          const officePredecessor = closureRecord.predecessors.office;
          const officeRef = Array.isArray(officePredecessor) ? officePredecessor[0] : officePredecessor;
          return officeRef.hash === dehydrateFact(office)[0].hash;
        })
      );

      const openOffice = testData.offices.find(office =>
        !testData.closures.some(closure => {
          const closureRecord = dehydrateFact(closure)[0];
          const officePredecessor = closureRecord.predecessors.office;
          const officeRef = Array.isArray(officePredecessor) ? officePredecessor[0] : officePredecessor;
          return officeRef.hash === dehydrateFact(office)[0].hash;
        })
      );

      if (!closedOffice || !openOffice) {
        throw new Error("Test data does not have both closed and open offices");
      }

      // Query closed office - should return result
      const closedOfficeRef: FactReference = dehydrateFact(closedOffice)[0];
      const closedResults = await store.read([closedOfficeRef], specification);
      expect(closedResults.length).toBe(1);

      // Query open office - should return empty
      const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];
      const openResults = await store.read([openOfficeRef], specification);
      expect(openResults.length).toBe(0);
    });
  });

  describe("Complex Given Conditions", () => {
    it("should handle offices closed but not reopened", async () => {
      const specification = SpecificationTemplates.officesClosedNotReopened();

      // Find offices that are closed but not reopened
      const closedNotReopenedOffice = testData.offices.find(office => {
        const officeClosure = testData.closures.find(closure => {
          const closureRecord = dehydrateFact(closure)[0];
          const officePredecessor = closureRecord.predecessors.office;
          const officeRef = Array.isArray(officePredecessor) ? officePredecessor[0] : officePredecessor;
          return officeRef.hash === dehydrateFact(office)[0].hash;
        });
        if (!officeClosure) return false;

        // Check if this closure has been reopened
        return !testData.reopenings.some(reopening => {
          const reopeningRecord = dehydrateFact(reopening)[0];
          const closurePredecessor = reopeningRecord.predecessors.closure;
          const closureRef = Array.isArray(closurePredecessor) ? closurePredecessor[0] : closurePredecessor;
          return closureRef.hash === dehydrateFact(officeClosure)[0].hash;
        });
      });

      if (!closedNotReopenedOffice) {
        // If no such office exists, skip test
        console.warn("No office closed but not reopened found in test data, skipping test");
        return;
      }

      const officeRef: FactReference = dehydrateFact(closedNotReopenedOffice)[0];

      const results = await store.read([officeRef], specification);
      expect(results.length).toBe(1);
    });

    it("should handle multiple givens (company + office)", async () => {
      const specification = SpecificationTemplates.companyOfficesNotClosed();

      const company = testData.companies[0];
      const openOffice = testData.offices.find(office =>
        !testData.closures.some(closure => {
          const closureRecord = dehydrateFact(closure)[0];
          const officePredecessor = closureRecord.predecessors.office;
          const officeRef = Array.isArray(officePredecessor) ? officePredecessor[0] : officePredecessor;
          return officeRef.hash === dehydrateFact(office)[0].hash;
        })
      );

      if (!openOffice) {
        throw new Error("No open office found in test data");
      }

      const companyRef: FactReference = dehydrateFact(company)[0];

      const officeRef: FactReference = dehydrateFact(openOffice)[0];

      const results = await store.read([companyRef, officeRef], specification);

      // Should return the company-office combination
      expect(results.length).toBe(1);
      expect(results[0].result.company.type).toBe("Company");
      expect(results[0].result.office.type).toBe("Office");
    });
  });

  describe("Performance and Reliability", () => {
    it("should handle medium-sized datasets efficiently", async () => {
      // Clean up current data and load medium dataset
      await harness.cleanup();

      harness = new IndexedDBStorageHarness();
      store = await harness.setup();
      testData = generateMediumCompanyNetwork();
      await harness.populate(testData);

      const specification = SpecificationTemplates.officesClosed();

      // Find a closed office
      const closedOffice = testData.offices.find(office =>
        testData.closures.some(closure => {
          const closureRecord = dehydrateFact(closure)[0];
          const officePredecessor = closureRecord.predecessors.office;
          const officeRef = Array.isArray(officePredecessor) ? officePredecessor[0] : officePredecessor;
          return officeRef.hash === dehydrateFact(office)[0].hash;
        })
      );

      if (!closedOffice) {
        throw new Error("No closed office found in medium test data");
      }

      const startTime = performance.now();
      const officeRef: FactReference = dehydrateFact(closedOffice)[0];

      const results = await store.read([officeRef], specification);
      const endTime = performance.now();

      expect(results.length).toBe(1);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it("should maintain data integrity across operations", async () => {
      // Perform multiple operations and verify data consistency
      const user = testData.users[0];
      const userRef: FactReference = dehydrateFact(user)[0];

      // Load user multiple times
      for (let i = 0; i < 3; i++) {
        const loaded = await store.load([userRef]);
        expect(loaded.length).toBeGreaterThan(0);
        expect(loaded[0].fact.type).toBe("User");
      }

      // Verify user still exists
      const existing = await store.whichExist([userRef]);
      expect(existing.length).toBe(1);
    });
  });
});