import { AuthenticationTest, FactEnvelope, FactManager, FactReference, Fork, Jinaga, MemoryStore, ObservableSource, User } from '../../src';

// Define a fake Fork implementation that captures saved facts
class FakeFork implements Fork {
    public savedEnvelopes: FactEnvelope[] = [];

    async save(envelopes: FactEnvelope[]): Promise<void> {
        this.savedEnvelopes = this.savedEnvelopes.concat(envelopes);
        return Promise.resolve();
    }

    async load(references: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }

    async close(): Promise<void> {
        return Promise.resolve();
    }
}

// Define an Environment fact type that will be owned by the single-use principal
class Environment {
    static Type = "Enterprise.Environment" as const;
    type = Environment.Type;

    constructor(
        public creator: User,
        public identifier: string
    ) { }
}

describe('SingleUse with FakeFork', () => {
    it('should create single-use principal', async () => {
        // Arrange
        const store = new MemoryStore();
        const fakeFork = new FakeFork();
        const observableSource = new ObservableSource(store);
        const authentication = new AuthenticationTest(store, null, null, null);
        const factManager = new FactManager(fakeFork, observableSource, store, {
            feeds: async () => [],
            fetchFeed: async () => ({ references: [], bookmark: '' }),
            streamFeed: () => () => {},
            load: async () => []
        }, []);
        const j = new Jinaga(authentication, factManager, null);
        
        // Act
        await j.singleUse(async (principal: User) => {
            // Assert
            expect(principal).toBeDefined();
            expect(principal.type).toBe('Jinaga.User');
            expect(principal.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
            return 0;
        });
    });

    it('should sign facts created by single-use principal', async () => {
        // Arrange
        const store = new MemoryStore();
        const fakeFork = new FakeFork();
        const observableSource = new ObservableSource(store);
        const authentication = new AuthenticationTest(store, null, null, null);
        const factManager = new FactManager(fakeFork, observableSource, store, {
            feeds: async () => [],
            fetchFeed: async () => ({ references: [], bookmark: '' }),
            streamFeed: () => () => {},
            load: async () => []
        }, []);
        const j = new Jinaga(authentication, factManager, null);
        
        // Act
        const publicKey = await j.singleUse(async (principal: User) => {
            await j.fact(new Environment(principal, "Production"));
            return principal.publicKey;
        });
        
        // Assert
        // Find the Environment fact in the saved envelopes
        const environmentFact = fakeFork.savedEnvelopes
            .filter(envelope => envelope.fact.type === "Enterprise.Environment")
            .map(envelope => envelope.fact);
        expect(environmentFact.length).toBe(1);
        
        // Find the signature for the Environment fact
        const environmentSignature = fakeFork.savedEnvelopes
            .filter(envelope => envelope.fact.type === "Enterprise.Environment")
            .flatMap(envelope => envelope.signatures);
        expect(environmentSignature.length).toBe(1);
        
        // Verify the signature uses the principal's public key
        expect(environmentSignature[0].publicKey).toBe(publicKey);
    });
});
