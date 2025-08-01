import { Jinaga } from '../../src/jinaga';
import { JinagaTest } from '../../src/jinaga-test';
import { buildModel } from '../../src/specification/model';
import { User } from '../../src/model/user';

class Task {
    static Type = "IntegrationTest.Task" as const;
    type = Task.Type;
    
    constructor(
        public creator: User,
        public title: string,
        public createdAt: Date | string
    ) { }
}

class TaskCompleted {
    static Type = "IntegrationTest.TaskCompleted" as const;
    type = TaskCompleted.Type;
    
    constructor(
        public task: Task,
        public completedAt: Date | string
    ) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Task, x => x
        .predecessor("creator", User)
    )
    .type(TaskCompleted, x => x
        .predecessor("task", Task)
    )
);

describe('factReference integration', () => {
    let j: Jinaga;

    beforeEach(async () => {
        j = JinagaTest.create({});
    });

    it('should work with query API using fact reference', async () => {
        // Create some test data
        const user = await j.fact(new User('test-public-key'));
        const task = await j.fact(new Task(user, 'Test task', new Date().toISOString()));
        
        // Get the hash of the user fact
        const userHash = j.hash(user);
        
        // Create a fact reference using the hash
        const userRef = j.factReference(User, userHash);
        
        // Query for tasks using the fact reference
        const tasks = await j.query(
            model.given(User).match((u, facts) => 
                facts.ofType(Task).join(t => t.creator, u)
            ),
            userRef
        );
        
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('Test task');
    });

    it('should work with static factReference method', async () => {
        // Create some test data
        const user = await j.fact(new User('static-test-key'));
        const userHash = j.hash(user);
        
        // Use static method
        const userRef = Jinaga.factReference(User, userHash);
        
        // Query should work
        const tasks = await j.query(
            model.given(User).match((u, facts) => 
                facts.ofType(Task).join(t => t.creator, u)
            ),
            userRef
        );
        
        expect(tasks).toHaveLength(0); // No tasks for this user yet
    });

    it('should work in complex query scenarios', async () => {
        // Create test data
        const user = await j.fact(new User('complex-test-key'));
        const task1 = await j.fact(new Task(user, 'Task 1', new Date().toISOString()));
        const task2 = await j.fact(new Task(user, 'Task 2', new Date().toISOString()));
        await j.fact(new TaskCompleted(task1, new Date().toISOString()));
        
        // Use fact reference to query for completed tasks by first finding all tasks, then their completions
        const userHash = j.hash(user);
        const userRef = j.factReference(User, userHash);
        
        // First get all tasks for the user
        const allTasks = await j.query(
            model.given(User).match((u, facts) =>
                facts.ofType(Task).join(t => t.creator, u)
            ),
            userRef
        );
        
        expect(allTasks).toHaveLength(2);
        
        // Then get completions for these tasks
        const completions = await j.query(
            model.given(Task).match((t, facts) =>
                facts.ofType(TaskCompleted).join(tc => tc.task, t)
            ),
            task1
        );
        
        expect(completions).toHaveLength(1);
    });

    it('should be usable with watch API', async () => {
        const user = await j.fact(new User('watch-test-key'));
        const userHash = j.hash(user);
        const userRef = j.factReference(User, userHash);
        
        // Test that watch can be set up with a factReference (doesn't need to return results immediately)
        const results: Task[] = [];
        
        const observer = j.watch(
            model.given(User).match((u, facts) => 
                facts.ofType(Task).join(t => t.creator, u)
            ),
            userRef,
            task => {
                results.push(task);
            }
        );
        
        // The main test is that watch doesn't crash with a factReference
        expect(observer).toBeDefined();
        expect(typeof observer.stop).toBe('function');
        
        observer.stop();
    });

    it('should handle errors gracefully when fact does not exist', async () => {
        // Use a hash that doesn't correspond to any actual fact
        const fakeHash = 'nonexistent+hash+that+is+fake+and+should+not+exist==';
        const userRef = j.factReference(User, fakeHash);
        
        // Query should not crash, just return empty results
        const tasks = await j.query(
            model.given(User).match((u, facts) => 
                facts.ofType(Task).join(t => t.creator, u)
            ),
            userRef
        );
        
        expect(tasks).toHaveLength(0);
    });

    it('should maintain type safety', async () => {
        const user = await j.fact(new User('type-safety-test'));
        const userHash = j.hash(user);
        
        // TypeScript should enforce correct typing
        const userRef = j.factReference(User, userHash);
        
        // This should compile without issues
        const publicKey: string = userRef.type;
        expect(publicKey).toBe('Jinaga.User');
        
        // The object should be treated as User type by TypeScript
        // (We can't test this at runtime, but it should compile)
        const query = model.given(User).match((u, facts) => 
            facts.ofType(Task).join(t => t.creator, u)
        );
        
        const tasks = await j.query(query, userRef);
        expect(Array.isArray(tasks)).toBe(true);
    });
});