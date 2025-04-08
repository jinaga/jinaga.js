import 'source-map-support/register';
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
                return {};
              } else if (key === 'PredType2:predhash2') {
                return {};
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
      expect(result).toContainEqual(mockQueuedEnvelope1);
      expect(result).toContainEqual(mockQueuedEnvelope2);
      expect(result).toContainEqual({ fact: mockPredecessorFact1, signatures: [] });
      expect(result).toContainEqual({ fact: mockPredecessorFact2, signatures: [] });
    });
    
    it('should handle facts with no ancestors', async () => {
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
      
      // Mock the execRequest function for different calls
      (driver.execRequest as jest.Mock)
        // First call - get queued envelopes
        .mockResolvedValueOnce([mockQueuedEnvelope1])
        // Second call - get ancestors (empty array)
        .mockResolvedValueOnce([]);
      
      const result = await queue.peek();
      
      // Should return only the queued fact
      expect(result).toHaveLength(1);
      expect(result).toContainEqual(mockQueuedEnvelope1);
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
                return {};
              } else if (key === 'PredType2:predhash2') {
                return {};
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
      expect(result).toContainEqual(mockEnvelopeWithSharedAncestor);
      expect(result).toContainEqual({ fact: mockPredecessorFact1, signatures: [] });
      expect(result).toContainEqual({ fact: mockPredecessorFact2, signatures: [] });
    });
  });
});