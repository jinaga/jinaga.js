import { AuthenticationTest, FactManager, Jinaga, MemoryStore, ObservableSource, PassThroughFork, User } from '../../src';

// Define a test fact type that will be owned by the single-use principal
class TestFact {
  static Type = "TestFact" as const;
  type = TestFact.Type;

  constructor(
    public owner: User,
    public value: string
  ) { }
}

describe('SingleUse with Store', () => {
  it('should create and sign facts with a single-use principal', async () => {
    // Arrange
    const store = new MemoryStore();
    const fork = new PassThroughFork(store);
    const observableSource = new ObservableSource(store);
    const authentication = new AuthenticationTest(store, null, null, null);
    const factManager = new FactManager(fork, observableSource, store, {
      feeds: async () => [],
      fetchFeed: async () => ({ references: [], bookmark: '' }),
      streamFeed: () => () => {},
      load: async () => []
    }, []);
    const j = new Jinaga(authentication, factManager, null);
    
    // Act
    const result = await j.singleUse(async (principal: User) => {
      // Create a fact owned by the principal
      const fact = await j.fact(new TestFact(principal, 'test value'));
      return fact;
    });
    
    // Assert
    expect(result).toBeDefined();
    expect(result.type).toBe('TestFact');
    expect(result.owner.type).toBe('Jinaga.User');
    expect(result.owner.publicKey).toBeDefined();
    expect(result.value).toBe('test value');
    
    // Verify that the fact was saved to the store
    const facts = await store.load([{
      type: 'TestFact',
      hash: Jinaga.hash(result)
    }]);
    
    // Find the TestFact in the returned facts
    const testFact = facts.find(f => f.fact.type === 'TestFact');
    expect(testFact).toBeDefined();
    expect(testFact!.fact.fields.value).toBe('test value');
    
    // Verify that the fact has a signature
    expect(testFact!.signatures.length).toBeGreaterThan(0);
    
    // Verify that the user fact was saved to the store
    const userFacts = await store.load([{
      type: 'Jinaga.User',
      hash: Jinaga.hash(result.owner)
    }]);
    expect(userFacts.length).toBe(1);
    expect(userFacts[0].fact.type).toBe('Jinaga.User');
    expect(userFacts[0].fact.fields.publicKey).toBeDefined();
    
    // Verify that the user fact has a signature
    expect(userFacts[0].signatures.length).toBeGreaterThan(0);
  });
});
