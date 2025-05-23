import { FactEnvelope, FactRecord, FactReference } from '../../src/storage';
import { IndexedDBQueue } from '../../src/indexeddb/indexeddb-queue';
import * as driver from '../../src/indexeddb/driver';

// Mock the IndexedDB driver functions
jest.mock('../../src/indexeddb/driver', () => {
  const originalModule = jest.requireActual('../../src/indexeddb/driver');
  
  return {
    ...originalModule,
    withDatabase: jest.fn(),
    withTransaction: jest.fn(),
    execRequest: jest.fn(),
    factKey: jest.fn((fact: FactReference) => `${fact.type}:${fact.hash}`)
  };
});

describe('IndexedDBQueue Topological Sorting', () => {
  let queue: IndexedDBQueue;
  
  beforeEach(() => {
    jest.clearAllMocks();
    queue = new IndexedDBQueue('test-index');
  });
  
  it('should handle empty queue', async () => {
    // Mock the database to return an empty queue
    mockDatabase([]);
    
    const result = await queue.peek();
    
    expect(result).toEqual([]);
  });
  
  it('should sort facts in a linear dependency chain', async () => {
    // Create a linear chain: A -> B -> C -> D
    const factA = createFact('A', 'hashA', {});
    const factB = createFact('B', 'hashB', { parent: factA });
    const factC = createFact('C', 'hashC', { parent: factB });
    const factD = createFact('D', 'hashD', { parent: factC });
    
    // Mock the database to return these facts in reverse order
    mockDatabase([
      createEnvelope(factD),
      createEnvelope(factC),
      createEnvelope(factB),
      createEnvelope(factA)
    ]);
    
    const result = await queue.peek();
    
    // Verify the facts are sorted in topological order
    expect(result).toHaveLength(4);
    expect(result[0].fact.type).toBe('A');
    expect(result[1].fact.type).toBe('B');
    expect(result[2].fact.type).toBe('C');
    expect(result[3].fact.type).toBe('D');
  });
  
  it('should sort facts in a diamond-shaped dependency pattern', async () => {
    // Create a diamond pattern: A -> B -> D
    //                           \-> C -/
    const factA = createFact('A', 'hashA', {});
    const factB = createFact('B', 'hashB', { parent: factA });
    const factC = createFact('C', 'hashC', { parent: factA });
    const factD = createFact('D', 'hashD', { parent1: factB, parent2: factC });
    
    // Mock the database to return these facts in a random order
    mockDatabase([
      createEnvelope(factD),
      createEnvelope(factA),
      createEnvelope(factC),
      createEnvelope(factB)
    ]);
    
    const result = await queue.peek();
    
    // Verify the facts are sorted in topological order
    expect(result).toHaveLength(4);
    expect(result[0].fact.type).toBe('A');
    // B and C can be in any order, but both must come before D
    expect(['B', 'C']).toContain(result[1].fact.type);
    expect(['B', 'C']).toContain(result[2].fact.type);
    expect(result[1].fact.type).not.toBe(result[2].fact.type);
    expect(result[3].fact.type).toBe('D');
  });
  
  it('should sort facts in multiple independent components', async () => {
    // Create two independent chains: A -> B and C -> D
    const factA = createFact('A', 'hashA', {});
    const factB = createFact('B', 'hashB', { parent: factA });
    const factC = createFact('C', 'hashC', {});
    const factD = createFact('D', 'hashD', { parent: factC });
    
    // Mock the database to return these facts in a mixed order
    mockDatabase([
      createEnvelope(factB),
      createEnvelope(factD),
      createEnvelope(factA),
      createEnvelope(factC)
    ]);
    
    const result = await queue.peek();
    
    // Verify the facts are sorted in topological order
    expect(result).toHaveLength(4);
    
    // A must come before B
    const indexA = result.findIndex(e => e.fact.type === 'A');
    const indexB = result.findIndex(e => e.fact.type === 'B');
    expect(indexA).toBeLessThan(indexB);
    
    // C must come before D
    const indexC = result.findIndex(e => e.fact.type === 'C');
    const indexD = result.findIndex(e => e.fact.type === 'D');
    expect(indexC).toBeLessThan(indexD);
  });
  
  it('should sort facts in a complex graph with multiple levels', async () => {
    // Create a complex graph:
    // A -> B -> D -> F
    // \-> C -> E -/
    const factA = createFact('A', 'hashA', {});
    const factB = createFact('B', 'hashB', { parent: factA });
    const factC = createFact('C', 'hashC', { parent: factA });
    const factD = createFact('D', 'hashD', { parent: factB });
    const factE = createFact('E', 'hashE', { parent: factC });
    const factF = createFact('F', 'hashF', { parent1: factD, parent2: factE });
    
    // Mock the database to return these facts in a random order
    mockDatabase([
      createEnvelope(factF),
      createEnvelope(factC),
      createEnvelope(factE),
      createEnvelope(factA),
      createEnvelope(factD),
      createEnvelope(factB)
    ]);
    
    const result = await queue.peek();
    
    // Verify the facts are sorted in topological order
    expect(result).toHaveLength(6);
    
    // A must be first
    expect(result[0].fact.type).toBe('A');
    
    // B and C can be in any order, but both must come after A
    const indexB = result.findIndex(e => e.fact.type === 'B');
    const indexC = result.findIndex(e => e.fact.type === 'C');
    expect(indexB).toBeGreaterThan(0);
    expect(indexC).toBeGreaterThan(0);
    
    // D must come after B
    const indexD = result.findIndex(e => e.fact.type === 'D');
    expect(indexD).toBeGreaterThan(indexB);
    
    // E must come after C
    const indexE = result.findIndex(e => e.fact.type === 'E');
    expect(indexE).toBeGreaterThan(indexC);
    
    // F must come after D and E
    const indexF = result.findIndex(e => e.fact.type === 'F');
    expect(indexF).toBeGreaterThan(indexD);
    expect(indexF).toBeGreaterThan(indexE);
  });
  
  it('should detect and report circular dependencies', async () => {
    // Create a cycle: A -> B -> C -> A
    const factA = createFact('A', 'hashA', {});
    const factB = createFact('B', 'hashB', { parent: factA });
    const factC = createFact('C', 'hashC', { parent: factB });
    
    // Create the circular dependency
    factA.predecessors.parent = { type: 'C', hash: 'hashC' };
    
    // Mock the database to return these facts
    mockDatabase([
      createEnvelope(factA),
      createEnvelope(factB),
      createEnvelope(factC)
    ]);
    
    // The peek method should throw an error about circular dependencies
    await expect(queue.peek()).rejects.toThrow('Circular dependencies detected');
  });
  
  it('should sort a large graph with many dependencies', async () => {
    // Create a large graph with 50 facts
    const facts: FactRecord[] = [];
    const envelopes: FactEnvelope[] = [];
    
    // Create 10 root facts with no predecessors
    for (let i = 0; i < 10; i++) {
      const fact = createFact(`Root${i}`, `hashRoot${i}`, {});
      facts.push(fact);
      envelopes.push(createEnvelope(fact));
    }
    
    // Create 40 facts with predecessors
    for (let i = 10; i < 50; i++) {
      const predecessors: { [role: string]: FactReference } = {};
      const numPredecessors = Math.min(3, i); // Up to 3 predecessors
      
      // Each fact depends on up to 3 previous facts
      for (let j = 0; j < numPredecessors; j++) {
        const predIndex = i - j - 1;
        predecessors[`parent${j}`] = {
          type: facts[predIndex].type,
          hash: facts[predIndex].hash
        };
      }
      
      const fact = createFact(`Fact${i}`, `hash${i}`, predecessors);
      facts.push(fact);
      envelopes.push(createEnvelope(fact));
    }
    
    // Shuffle the envelopes
    const shuffledEnvelopes = [...envelopes].sort(() => Math.random() - 0.5);
    
    // Mock the database to return the shuffled envelopes
    mockDatabase(shuffledEnvelopes);
    
    const result = await queue.peek();
    
    // Verify the facts are sorted in topological order
    expect(result).toHaveLength(50);
    
    // Create a map of fact types to their positions in the result
    const positionMap = new Map<string, number>();
    result.forEach((envelope, index) => {
      positionMap.set(envelope.fact.type, index);
    });
    
    // Verify that for each fact, all its predecessors appear earlier in the result
    for (const fact of facts) {
      const factPosition = positionMap.get(fact.type)!;
      
      for (const role in fact.predecessors) {
        const predecessor = fact.predecessors[role];
        if (Array.isArray(predecessor)) {
          for (const pred of predecessor) {
            const predPosition = positionMap.get(pred.type)!;
            expect(predPosition).toBeLessThan(factPosition);
          }
        } else {
          const predPosition = positionMap.get(predecessor.type)!;
          expect(predPosition).toBeLessThan(factPosition);
        }
      }
    }
  });
});

// Helper functions

function createFact(type: string, hash: string, predecessors: { [role: string]: any }): FactRecord {
  return {
    type,
    hash,
    predecessors,
    fields: {}
  };
}

function createEnvelope(fact: FactRecord): FactEnvelope {
  return {
    fact,
    signatures: []
  };
}

function mockDatabase(envelopes: FactEnvelope[]) {
  // Create a map of fact keys to ancestors
  const ancestorMap = new Map<string, string[]>();
  
  // For each fact, calculate its ancestors
  for (const envelope of envelopes) {
    const fact = envelope.fact;
    const key = `${fact.type}:${fact.hash}`;
    
    // Start with an empty set of ancestors
    let ancestors: string[] = [];
    
    // Add direct predecessors
    for (const role in fact.predecessors) {
      const predecessors = fact.predecessors[role];
      if (Array.isArray(predecessors)) {
        for (const predecessor of predecessors) {
          const predKey = `${predecessor.type}:${predecessor.hash}`;
          ancestors.push(predKey);
          
          // Add transitive predecessors
          if (ancestorMap.has(predKey)) {
            ancestors = ancestors.concat(ancestorMap.get(predKey)!);
          }
        }
      } else {
        const predKey = `${predecessors.type}:${predecessors.hash}`;
        ancestors.push(predKey);
        
        // Add transitive predecessors
        if (ancestorMap.has(predKey)) {
          ancestors = ancestors.concat(ancestorMap.get(predKey)!);
        }
      }
    }
    
    // Remove duplicates
    ancestors = [...new Set(ancestors)];
    
    // Store the ancestors
    ancestorMap.set(key, ancestors);
  }
  
  // Mock the database functions
  (driver.withDatabase as jest.Mock).mockImplementation((_, callback) => callback({}));
  (driver.withTransaction as jest.Mock).mockImplementation((_, __, ___, callback) => {
    const mockObjectStores: { [key: string]: any } = {
      queue: {
        getAll: () => ({ objectStore: 'queue', method: 'getAll' })
      },
      fact: {
        get: (key: string) => {
          // Find the fact with the given key
          for (const envelope of envelopes) {
            const factKey = `${envelope.fact.type}:${envelope.fact.hash}`;
            if (factKey === key) {
              return envelope.fact;
            }
          }
          return null;
        }
      },
      ancestor: {
        get: (key: string) => {
          // Return the ancestors for the given key
          return ancestorMap.get(key) || [];
        }
      }
    };
    
    return callback({
      objectStore: (name: string) => mockObjectStores[name]
    });
  });
  
  // Mock the execRequest function
  (driver.execRequest as jest.Mock).mockImplementation((request: any) => {
    // If the request is for the queue's getAll method
    if (request && request.method === 'getAll' && request.objectStore === 'queue') {
      return Promise.resolve(envelopes);
    }
    
    // If the request is for a specific fact
    if (request && request.get !== undefined && request.objectStore === 'fact') {
      const key = request.get;
      for (const envelope of envelopes) {
        const factKey = `${envelope.fact.type}:${envelope.fact.hash}`;
        if (factKey === key) {
          return Promise.resolve(envelope.fact);
        }
      }
      return Promise.resolve(null);
    }
    
    // If the request is for ancestors
    if (request && request.get !== undefined && request.objectStore === 'ancestor') {
      const key = request.get;
      return Promise.resolve(ancestorMap.get(key) || []);
    }
    
    return Promise.resolve(null);
  });
}