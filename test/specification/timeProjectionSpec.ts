import { Jinaga, User, MemoryStore, AuthenticationNoOp, PassThroughFork, ObservableSource, FactManager, NetworkNoOp, SyncStatusNotifier, SpecificationParser, SpecificationOf } from "@src";

class UserName {
    static Type = "UserName" as const;
    type = UserName.Type;

    constructor(
        public user: User,
        public value: string
    ) { }
}

describe("Time projection", () => {
    it("returns the time when a fact was learned", async () => {
        // Create Jinaga instance
        const j = createJinagaWithTimeProvider();
        
        // Record time before creating the fact
        const timeBefore = new Date();
        
        // Create a user fact
        const user = await j.fact(new User("--- TEST PUBLIC KEY ---"));
        
        // Record time after creating the fact
        const timeAfter = new Date();
        
        // Parse specification with time projection
        const parser = new SpecificationParser("(user: Jinaga.User) { } => @user");
        parser.skipWhitespace();
        const specification = parser.parseSpecification();
        
        // Query with time projection
        const results = await j.query(new SpecificationOf(specification), user);
        
        // Verify we got exactly one result
        expect(results).toHaveLength(1);
        
        // Verify the result is a Date object
        expect(results[0]).toBeInstanceOf(Date);
        
        // Verify the timestamp is within the expected range
        const timestamp = results[0] as Date;
        expect(timestamp.getTime()).toBeGreaterThanOrEqual(timeBefore.getTime());
        expect(timestamp.getTime()).toBeLessThanOrEqual(timeAfter.getTime());
    });

    it("returns different timestamps for facts saved at different times", async () => {
        // Setup mocked time provider
        let currentTime = new Date("2025-01-01T12:00:00Z");
        const timeProvider = () => currentTime;
        
        // Create Jinaga instance with mocked time
        const j = createJinagaWithTimeProvider(timeProvider);
        
        // Create a user fact
        const user = await j.fact(new User("--- TEST PUBLIC KEY ---"));
        
        // Create first name fact at time T1
        const time1 = new Date("2025-01-01T12:00:00Z");
        currentTime = time1;
        await j.fact(new UserName(user, "Alice"));
        
        // Advance the mocked time
        const time2 = new Date("2025-01-01T13:00:00Z");
        currentTime = time2;
        
        // Create second name fact at time T2
        await j.fact(new UserName(user, "Bob"));
        
        // Parse specification with time projection
        const parser = new SpecificationParser("(user: Jinaga.User) { name: UserName [name->user: Jinaga.User = user] } => @name");
        parser.skipWhitespace();
        const specification = parser.parseSpecification();
        
        // Query both names with time projection
        const results = await j.query(new SpecificationOf(specification), user);
        
        // Verify we got exactly two results
        expect(results).toHaveLength(2);
        
        // Verify both results are Date objects
        expect(results[0]).toBeInstanceOf(Date);
        expect(results[1]).toBeInstanceOf(Date);
        
        // Get the timestamps sorted
        const timestamps = results as Date[];
        const sortedTimestamps = timestamps.map(t => t.getTime()).sort();
        
        // Verify timestamps are different and match expected times
        expect(sortedTimestamps[0]).toBe(time1.getTime());
        expect(sortedTimestamps[1]).toBe(time2.getTime());
    });
});

function createJinagaWithTimeProvider(timeProvider?: () => Date): Jinaga {
    const store = new MemoryStore(timeProvider);
    const observableSource = new ObservableSource(store);
    const syncStatusNotifier = new SyncStatusNotifier();
    const fork = new PassThroughFork(store);
    const authentication = new AuthenticationNoOp();
    const network = new NetworkNoOp();
    const factManager = new FactManager(fork, observableSource, store, network, []);
    return new Jinaga(authentication, factManager, syncStatusNotifier);
}