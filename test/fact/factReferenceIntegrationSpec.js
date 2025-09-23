"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
class Task {
    constructor(creator, title, createdAt) {
        this.creator = creator;
        this.title = title;
        this.createdAt = createdAt;
        this.type = Task.Type;
    }
}
Task.Type = "IntegrationTest.Task";
class TaskCompleted {
    constructor(task, completedAt) {
        this.task = task;
        this.completedAt = completedAt;
        this.type = TaskCompleted.Type;
    }
}
TaskCompleted.Type = "IntegrationTest.TaskCompleted";
const model = (0, _src_1.buildModel)(b => b
    .type(_src_1.User)
    .type(Task, x => x
    .predecessor("creator", _src_1.User))
    .type(TaskCompleted, x => x
    .predecessor("task", Task)));
describe('factReference integration', () => {
    let j;
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        j = _src_1.JinagaTest.create({});
    }));
    it('should work with query API using fact reference', () => __awaiter(void 0, void 0, void 0, function* () {
        // Create some test data
        const user = yield j.fact(new _src_1.User('test-public-key'));
        const task = yield j.fact(new Task(user, 'Test task', new Date().toISOString()));
        // Get the hash of the user fact
        const userHash = j.hash(user);
        // Create a fact reference using the hash
        const userRef = j.factReference(_src_1.User, userHash);
        // Query for tasks using the fact reference
        const tasks = yield j.query(model.given(_src_1.User).match((u, facts) => facts.ofType(Task).join(t => t.creator, u)), userRef);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('Test task');
    }));
    it('should work with static factReference method', () => __awaiter(void 0, void 0, void 0, function* () {
        // Create some test data
        const user = yield j.fact(new _src_1.User('static-test-key'));
        const userHash = j.hash(user);
        // Use static method
        const userRef = _src_1.Jinaga.factReference(_src_1.User, userHash);
        // Query should work
        const tasks = yield j.query(model.given(_src_1.User).match((u, facts) => facts.ofType(Task).join(t => t.creator, u)), userRef);
        expect(tasks).toHaveLength(0); // No tasks for this user yet
    }));
    it('should work in complex query scenarios', () => __awaiter(void 0, void 0, void 0, function* () {
        // Create test data
        const user = yield j.fact(new _src_1.User('complex-test-key'));
        const task1 = yield j.fact(new Task(user, 'Task 1', new Date().toISOString()));
        const task2 = yield j.fact(new Task(user, 'Task 2', new Date().toISOString()));
        yield j.fact(new TaskCompleted(task1, new Date().toISOString()));
        // Use fact reference to query for completed tasks by first finding all tasks, then their completions
        const userHash = j.hash(user);
        const userRef = j.factReference(_src_1.User, userHash);
        // First get all tasks for the user
        const allTasks = yield j.query(model.given(_src_1.User).match((u, facts) => facts.ofType(Task).join(t => t.creator, u)), userRef);
        expect(allTasks).toHaveLength(2);
        // Then get completions for these tasks
        const completions = yield j.query(model.given(Task).match((t, facts) => facts.ofType(TaskCompleted).join(tc => tc.task, t)), task1);
        expect(completions).toHaveLength(1);
    }));
    it('should be usable with watch API', () => __awaiter(void 0, void 0, void 0, function* () {
        const user = yield j.fact(new _src_1.User('watch-test-key'));
        const userHash = j.hash(user);
        const userRef = j.factReference(_src_1.User, userHash);
        // Test that watch can be set up with a factReference (doesn't need to return results immediately)
        const results = [];
        const observer = j.watch(model.given(_src_1.User).match((u, facts) => facts.ofType(Task).join(t => t.creator, u)), userRef, task => {
            results.push(task);
        });
        // The main test is that watch doesn't crash with a factReference
        expect(observer).toBeDefined();
        expect(typeof observer.stop).toBe('function');
        observer.stop();
    }));
    it('should handle errors gracefully when fact does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
        // Use a hash that doesn't correspond to any actual fact
        const fakeHash = 'nonexistent+hash+that+is+fake+and+should+not+exist==';
        const userRef = j.factReference(_src_1.User, fakeHash);
        // Query should not crash, just return empty results
        const tasks = yield j.query(model.given(_src_1.User).match((u, facts) => facts.ofType(Task).join(t => t.creator, u)), userRef);
        expect(tasks).toHaveLength(0);
    }));
    it('should maintain type safety', () => __awaiter(void 0, void 0, void 0, function* () {
        const user = yield j.fact(new _src_1.User('type-safety-test'));
        const userHash = j.hash(user);
        // TypeScript should enforce correct typing
        const userRef = j.factReference(_src_1.User, userHash);
        // This should compile without issues
        const publicKey = userRef.type;
        expect(publicKey).toBe('Jinaga.User');
        // The object should be treated as User type by TypeScript
        // (We can't test this at runtime, but it should compile)
        const query = model.given(_src_1.User).match((u, facts) => facts.ofType(Task).join(t => t.creator, u));
        const tasks = yield j.query(query, userRef);
        expect(Array.isArray(tasks)).toBe(true);
    }));
});
//# sourceMappingURL=factReferenceIntegrationSpec.js.map