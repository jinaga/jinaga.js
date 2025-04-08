import 'source-map-support/register';
import { FactEnvelope, FactRecord, FactReference } from '../../src/storage';
import { IndexedDBQueue } from '../../src/indexeddb/indexeddb-queue';
import * as driver from '../../src/indexeddb/driver';
import { TopologicalSorter } from '../../src/fact/sorter';

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

describe('IndexedDBQueue', () => {
  let queue: IndexedDBQueue;
  
  // Mock data
  const mockQueuedFact1: FactRecord = {
    type: 'TestType1',
    hash: 'hash1',
    predecessors: {
      role1: { type: 'PredType1', hash: 'predhash1' }
    },
    fields: { field1: 'value1' }
  };
  
  const mockQueuedFact2: FactRecord = {
    type: 'TestType2',
    hash: 'hash2',
    predecessors: {
      role2: { type: 'PredType2', hash: 'predhash2' }
    },
    fields: { field2: 'value2' }
  };
  
  const mockPredecessorFact1: FactRecord = {
    type: 'PredType1',
    hash: 'predhash1',
    predecessors: {},
    fields: { predField1: 'predValue1' }
  };
  
  const mockPredecessorFact2: FactRecord = {
    type: 'PredType2',
    hash: 'predhash2',
    predecessors: {},
    fields: { predField2: 'predValue2' }
  };
  
  const mockQueuedEnvelope1: FactEnvelope = {
    fact: mockQueuedFact1,
    signatures: []
  };
  
  const mockQueuedEnvelope2: FactEnvelope = {
    fact: mockQueuedFact2,
    signatures: []
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
    queue = new IndexedDBQueue('test-index');
  });
  
  describe('peek', () => {
    it('should return an empty array when the queue is empty', async () => {
      // Mock the execRequest function to return an empty array for the queue
      (driver.execRequest as jest.Mock).mockResolvedValueOnce([]);
      
      // Mock the withDatabase and withTransaction functions
      (driver.withDatabase as jest.Mock).mockImplementation((_, callback) => callback({}));
      (driver.withTransaction as jest.Mock).mockImplementation((_, __, ___, callback) => callback({
        objectStore: () => ({
          getAll: () => ({})
        })
      }));
      
      const result = await queue.peek();
      
      expect(result).toEqual([]);
      expect(driver.withTransaction).toHaveBeenCalledWith(
        expect.anything(),
        ['queue', 'fact', 'ancestor'],
        'readonly',
        expect.any(Function)
      );
    });
    
    it('should return queued facts and their ancestors', async () => {
      // Mock the withDatabase and withTransaction functions
      (driver.withDatabase as jest.Mock).mockImplementation((_, callback) => callback({}));
      (driver.withTransaction as jest.Mock).mockImplementation((_, __, ___, callback) => {
        const mockObjectStores: { [key: string]: any } = {
          queue: {
            getAll: () => ({})
          },
          fact: {
            get: (key: string) => {
              if (key === 'PredType1:predhash1') {
                return mockPredecessorFact1;
              } else if (key === 'PredType2:predhash2') {
                return mockPredecessorFact2;
              } else if (key === 'TestType1:hash1') {
                return mockQueuedFact1;
              } else if (key === 'TestType2:hash2') {
                return mockQueuedFact2;
              }
              return {};
            }
          },
          ancestor: {
            get: (key: string) => {
              if (key === 'TestType1:hash1') {
                return {};
              } else if (key === 'TestType2:hash2') {
                return {};
              }
              return {};
            }
          }
        };
        
        return callback({
          objectStore: (name: string) => mockObjectStores[name]
        });
      });
      
      // Mock the execRequest function for different calls
      (driver.execRequest as jest.Mock)
        // First call - get queued envelopes
        .mockResolvedValueOnce([mockQueuedEnvelope1, mockQueuedEnvelope2])
        // Second and third calls - get ancestors for queued facts
        .mockResolvedValueOnce(['TestType1:hash1', 'PredType1:predhash1'])
        .mockResolvedValueOnce(['TestType2:hash2', 'PredType2:predhash2'])
        // Fourth and fifth calls - get fact records for ancestors
        .mockResolvedValueOnce(mockPredecessorFact1)
        .mockResolvedValueOnce(mockPredecessorFact2);
      
      const result = await queue.peek();
      
      // Should return both queued facts and their ancestors
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ fact: mockPredecessorFact1, signatures: [] });
      expect(result[1]).toEqual({ fact: mockPredecessorFact2, signatures: [] });
      expect(result[2]).toEqual(mockQueuedEnvelope1);
      expect(result[3]).toEqual(mockQueuedEnvelope2);
    });
    
    it('should handle facts with no ancestors', async () => {
      // Create a fact with no predecessors
      const mockFactNoAncestors: FactRecord = {
        type: 'TestTypeNoAncestors',
        hash: 'hashNoAncestors',
        predecessors: {},
        fields: { field: 'value' }
      };
      
      const mockEnvelopeNoAncestors: FactEnvelope = {
        fact: mockFactNoAncestors,
        signatures: []
      };
      
      // Mock the withDatabase and withTransaction functions
      (driver.withDatabase as jest.Mock).mockImplementation((_, callback) => callback({}));
      (driver.withTransaction as jest.Mock).mockImplementation((_, __, ___, callback) => {
        const mockObjectStores: { [key: string]: any } = {
          queue: {
            getAll: () => ({})
          },
          fact: {
            get: () => ({})
          },
          ancestor: {
            get: () => ({})
          }
        };
        
        return callback({
          objectStore: (name: string) => mockObjectStores[name]
        });
      });
      
      // Mock the execRequest function
      (driver.execRequest as jest.Mock)
        // First call - get queued envelopes
        .mockResolvedValueOnce([mockEnvelopeNoAncestors])
        // Second call - get ancestors (empty array)
        .mockResolvedValueOnce([]);
      
      const result = await queue.peek();
      
      // Should return only the queued fact
      expect(result).toHaveLength(1);
      expect(result).toContainEqual(mockEnvelopeNoAncestors);
    });
    
    it('should sort facts in topological order', async () => {
      // Create a chain of facts where each depends on the previous one
      const mockFact1: FactRecord = {
        type: 'Type1',
        hash: 'hash1',
        predecessors: {},
        fields: { field1: 'value1' }
      };
      
      const mockFact2: FactRecord = {
        type: 'Type2',
        hash: 'hash2',
        predecessors: {
          role1: { type: 'Type1', hash: 'hash1' }
        },
        fields: { field2: 'value2' }
      };
      
      const mockFact3: FactRecord = {
        type: 'Type3',
        hash: 'hash3',
        predecessors: {
          role2: { type: 'Type2', hash: 'hash2' }
        },
        fields: { field3: 'value3' }
      };
      
      const mockEnvelope1: FactEnvelope = {
        fact: mockFact1,
        signatures: []
      };
      
      const mockEnvelope2: FactEnvelope = {
        fact: mockFact2,
        signatures: []
      };
      
      const mockEnvelope3: FactEnvelope = {
        fact: mockFact3,
        signatures: []
      };
      
      // Mock the withDatabase and withTransaction functions
      (driver.withDatabase as jest.Mock).mockImplementation((_, callback) => callback({}));
      (driver.withTransaction as jest.Mock).mockImplementation((_, __, ___, callback) => {
        const mockObjectStores: { [key: string]: any } = {
          queue: {
            getAll: () => ({})
          },
          fact: {
            get: (key: string) => {
              if (key === 'Type1:hash1') {
                return mockFact1;
              } else if (key === 'Type2:hash2') {
                return mockFact2;
              } else if (key === 'Type3:hash3') {
                return mockFact3;
              }
              return {};
            }
          },
          ancestor: {
            get: () => ({})
          }
        };
        
        return callback({
          objectStore: (name: string) => mockObjectStores[name]
        });
      });
      
      // Mock the execRequest function to return the envelopes in reverse order
      // This tests that the function sorts them correctly
      (driver.execRequest as jest.Mock)
        // First call - get queued envelopes (in reverse order)
        .mockResolvedValueOnce([mockEnvelope3, mockEnvelope2, mockEnvelope1])
        // Second call - get ancestors (empty array)
        .mockResolvedValueOnce([]);
      
      const result = await queue.peek();
      
      // Should return the facts in topological order
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(mockEnvelope1); // Type1 should be first
      expect(result[1]).toEqual(mockEnvelope2); // Type2 should be second
      expect(result[2]).toEqual(mockEnvelope3); // Type3 should be third
    });
    
    it('should detect circular dependencies', async () => {
      // Create a circular dependency: A depends on B, B depends on C, C depends on A
      const mockFactA: FactRecord = {
        type: 'TypeA',
        hash: 'hashA',
        predecessors: {
          roleC: { type: 'TypeC', hash: 'hashC' }
        },
        fields: { fieldA: 'valueA' }
      };
      
      const mockFactB: FactRecord = {
        type: 'TypeB',
        hash: 'hashB',
        predecessors: {
          roleA: { type: 'TypeA', hash: 'hashA' }
        },
        fields: { fieldB: 'valueB' }
      };
      
      const mockFactC: FactRecord = {
        type: 'TypeC',
        hash: 'hashC',
        predecessors: {
          roleB: { type: 'TypeB', hash: 'hashB' }
        },
        fields: { fieldC: 'valueC' }
      };
      
      const mockEnvelopeA: FactEnvelope = {
        fact: mockFactA,
        signatures: []
      };
      
      const mockEnvelopeB: FactEnvelope = {
        fact: mockFactB,
        signatures: []
      };
      
      const mockEnvelopeC: FactEnvelope = {
        fact: mockFactC,
        signatures: []
      };
      
      // Mock the withDatabase and withTransaction functions
      (driver.withDatabase as jest.Mock).mockImplementation((_, callback) => callback({}));
      (driver.withTransaction as jest.Mock).mockImplementation((_, __, ___, callback) => {
        const mockObjectStores: { [key: string]: any } = {
          queue: {
            getAll: () => ({})
          },
          fact: {
            get: () => ({})
          },
          ancestor: {
            get: () => ({})
          }
        };
        
        return callback({
          objectStore: (name: string) => mockObjectStores[name]
        });
      });
      
      // Mock the execRequest function
      (driver.execRequest as jest.Mock)
        // First call - get queued envelopes
        .mockResolvedValueOnce([mockEnvelopeA, mockEnvelopeB, mockEnvelopeC])
        // Second call - get ancestors (empty array)
        .mockResolvedValueOnce([]);
      
      // Should throw an error about circular dependencies
      await expect(queue.peek()).rejects.toThrow('Circular dependencies detected');
    });
    
    it('should correctly sort facts in topological order', async () => {
      // Create facts with a predecessor relationship
      const mockFact1: FactRecord = {
        type: 'Type1',
        hash: 'hash1',
        predecessors: {
          role2: { type: 'Type2', hash: 'hash2' } // This creates a dependency on mockFact2
        },
        fields: { field1: 'value1' }
      };
      
      const mockFact2: FactRecord = {
        type: 'Type2',
        hash: 'hash2',
        predecessors: {},
        fields: { field2: 'value2' }
      };
      
      const mockEnvelope1: FactEnvelope = {
        fact: mockFact1,
        signatures: []
      };
      
      const mockEnvelope2: FactEnvelope = {
        fact: mockFact2,
        signatures: []
      };
      
      // Mock the withDatabase and withTransaction functions
      (driver.withDatabase as jest.Mock).mockImplementation((_, callback) => callback({}));
      (driver.withTransaction as jest.Mock).mockImplementation((_, __, ___, callback) => {
        const mockObjectStores: { [key: string]: any } = {
          queue: {
            getAll: () => ({})
          },
          fact: {
            get: (key: string) => {
              if (key === 'Type1:hash1') {
                return mockFact1;
              } else if (key === 'Type2:hash2') {
                return mockFact2;
              }
              return {};
            }
          },
          ancestor: {
            get: () => ({})
          }
        };
        
        return callback({
          objectStore: (name: string) => mockObjectStores[name]
        });
      });
      
      // Mock the execRequest function
      (driver.execRequest as jest.Mock)
        // First call - get queued envelopes
        .mockResolvedValueOnce([mockEnvelope1, mockEnvelope2])
        // Second call - get ancestors (empty array)
        .mockResolvedValueOnce([]);
      
      // Should correctly sort the facts in topological order
      const result = await queue.peek();
      expect(result).toEqual([mockEnvelope2, mockEnvelope1]);
    });
    
    it('should not return duplicate ancestors', async () => {
      // Create a fact with multiple predecessors that share an ancestor
      const mockFactWithSharedAncestor: FactRecord = {
        type: 'TestType3',
        hash: 'hash3',
        predecessors: {
          role1: { type: 'PredType1', hash: 'predhash1' },
          role2: { type: 'PredType2', hash: 'predhash2' }
        },
        fields: { field3: 'value3' }
      };
      
      const mockEnvelopeWithSharedAncestor: FactEnvelope = {
        fact: mockFactWithSharedAncestor,
        signatures: []
      };
      
      // Mock the withDatabase and withTransaction functions
      (driver.withDatabase as jest.Mock).mockImplementation((_, callback) => callback({}));
      (driver.withTransaction as jest.Mock).mockImplementation((_, __, ___, callback) => {
        const mockObjectStores: { [key: string]: any } = {
          queue: {
            getAll: () => ({})
          },
          fact: {
            get: (key: string) => {
              if (key === 'PredType1:predhash1') {
                return mockPredecessorFact1;
              } else if (key === 'PredType2:predhash2') {
                return mockPredecessorFact2;
              } else if (key === 'TestType3:hash3') {
                return mockFactWithSharedAncestor;
              }
              return {};
            }
          },
          ancestor: {
            get: () => ({})
          }
        };
        
        return callback({
          objectStore: (name: string) => mockObjectStores[name]
        });
      });
      
      // Mock the execRequest function for different calls
      (driver.execRequest as jest.Mock)
        // First call - get queued envelopes
        .mockResolvedValueOnce([mockEnvelopeWithSharedAncestor])
        // Second call - get ancestors with duplicates
        .mockResolvedValueOnce(['PredType1:predhash1', 'PredType2:predhash2', 'PredType1:predhash1'])
        // Third and fourth calls - get fact records for ancestors
        .mockResolvedValueOnce(mockPredecessorFact1)
        .mockResolvedValueOnce(mockPredecessorFact2);
      
      const result = await queue.peek();
      
      // Should return the queued fact and its two distinct ancestors
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ fact: mockPredecessorFact1, signatures: [] });
      expect(result[1]).toEqual({ fact: mockPredecessorFact2, signatures: [] });
      expect(result[2]).toEqual(mockEnvelopeWithSharedAncestor);
    });
  });
});