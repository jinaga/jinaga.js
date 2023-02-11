import { dehydrateFact, dehydrateReference } from "../../src/fact/hydrate";
import { PassThroughFork } from "../../src/fork/pass-through-fork";
import { FactManager } from "../../src/managers/factManager";
import { NetworkManager, NetworkNoOp } from "../../src/managers/NetworkManager";
import { MemoryStore } from "../../src/memory/memory-store";
import { ObservableSource } from "../../src/observable/observable";
import { runService } from "../../src/observable/service";
import { fromDescriptiveString } from "../../src/query/descriptive-string";
import { ServiceRunner } from "../../src/util/serviceRunner";
import { AuthenticationNoOp } from "../query/AuthenticationNoOp";

class TestContext {
    private factManager: FactManager;
    private exceptions: any[] = [];
    private serviceRunner = new ServiceRunner(exception => this.exceptions.push(exception.message));

    constructor() {
        const memory = new MemoryStore();
        const observableSource = new ObservableSource(memory);
        const fork = new PassThroughFork(memory);
        const authentication = new AuthenticationNoOp();
        const network = new NetworkNoOp();
        this.factManager = new FactManager(authentication, fork, observableSource, memory, network);
    }

    async fact(fact: {}) {
        const records = dehydrateFact(fact);
        const envelopes = records.map(f => ({ fact: f, signatures: [] }));
        await this.factManager.save(envelopes);
    }

    async run(fact: {}, queryString: string, handler: (message: {}) => Promise<void>) {
        try {
            const start = dehydrateReference(fact);
            const query = fromDescriptiveString(queryString);
            const subscription = runService(this.factManager, start, query, this.serviceRunner, handler);
            await subscription.load();
        }
        catch (exception) {
            if (exception instanceof Error) {
                this.exceptions.push(exception.message);
            }
        }
    }

    async stop() {
        await this.serviceRunner.all();
    }

    expectNoExceptions() {
        expect(this.exceptions).toEqual([]);
    }

    expectExceptions(expected: string[]) {
        expect(this.exceptions).toEqual(expected);
    }
}

describe('Service', () => {
    it('should not run for empty store', async () => {
        const context = new TestContext();

        const start = {
            type: 'Start',
            value: 1
        };
        let runs = 0;
        await context.run(start, 'S.parent F.type="Child"', async _ => { ++runs; });
        await context.stop();
        context.expectNoExceptions();
        expect(runs).toEqual(0);
    });

    it('should run for existing fact', async () => {
        const context = new TestContext();

        const start = {
            type: 'Start',
            value: 1
        };
        await context.fact({
            type: 'Child',
            parent: start
        });
        let runs = 0;
        await context.run(start, 'S.parent F.type="Child" N(S.child F.type="Handled")', async child => {
            ++runs;
            await context.fact({
                type: 'Handled',
                child: child
            });
        });
        await context.stop();
        context.expectNoExceptions();
        expect(runs).toEqual(1);
    });

    it('should run for new fact', async () => {
        const context = new TestContext();

        const start = {
            type: 'Start',
            value: 1
        };
        let runs = 0;
        await context.run(start, 'S.parent F.type="Child" N(S.child F.type="Handled")', async child => {
            ++runs;
            await context.fact({
                type: 'Handled',
                child: child
            });
        });
        await context.fact({
            type: 'Child',
            parent: start
        });
        await context.stop();
        context.expectNoExceptions();
        expect(runs).toEqual(1);
    });

    it('should fail if handler does not remove fact', async () => {
        const context = new TestContext();

        const start = {
            type: 'Start',
            value: 1
        };
        await context.fact({
            type: 'Child',
            parent: start
        });
        let runs = 0;
        await context.run(start, 'S.parent F.type="Child" N(S.child F.type="Handled")', async child => {
            ++runs;
        });
        await context.stop();
        context.expectExceptions([
            'The handler did not remove the processed message from the query \'S.parent F.type="Child" N(S.child F.type="Handled")\'. This process will be duplicated the next time the service is run.'
        ]);
        expect(runs).toEqual(1);
    });
});