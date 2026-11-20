import { FactEnvelope, FactRecord, FactReference, IndexedDBQueue } from '@src';

/**
 * What the queue stores alongside each fact: the user who was current when the
 * fact was written (issue #412). These run against the real store, because what
 * is being checked is what a queued value carries when it is read back in a
 * later session -- which is the only place the recorded user matters.
 */
describe('IndexedDBQueue records the user who wrote each fact', () => {
    let databaseNumber = 0;

    function createQueue(): IndexedDBQueue {
        databaseNumber++;
        return new IndexedDBQueue(`queue-user-test-${databaseNumber}`);
    }

    const alice: FactReference = {
        type: 'Jinaga.User',
        hash: 'public-key-of-alice'
    };
    const bob: FactReference = {
        type: 'Jinaga.User',
        hash: 'public-key-of-bob'
    };

    function envelopeFor(hash: string): FactEnvelope {
        const fact: FactRecord = {
            type: 'Test.Fact',
            hash,
            predecessors: {},
            fields: {}
        };
        return { fact, signatures: [] };
    }

    it('returns the user a fact was enqueued with', async () => {
        const queue = createQueue();

        await queue.enqueue([envelopeFor('written-by-alice')], alice);

        const queued = await queue.peek();
        expect(queued.map(envelope => envelope.fact.hash)).toEqual(['written-by-alice']);
        expect(queued[0].user).toEqual(alice);
    });

    it('returns no user for a fact enqueued without one', async () => {
        const queue = createQueue();

        await queue.enqueue([envelopeFor('written-by-nobody')]);

        const queued = await queue.peek();
        expect(queued[0].user).toBeUndefined();
    });

    it('keeps the user a queued fact was written with when it is enqueued again', async () => {
        // A write sends the facts its prototype names as predecessors, so an
        // already-queued fact reaches enqueue again under whoever is current
        // then. The fact was written once, and that is when its user was
        // current, so the later arrival does not re-attribute it.
        const queue = createQueue();
        await queue.enqueue([envelopeFor('written-by-alice')], alice);

        await queue.enqueue([envelopeFor('written-by-alice')], bob);

        const queued = await queue.peek();
        expect(queued).toHaveLength(1);
        expect(queued[0].user).toEqual(alice);
    });

    it('leaves a fact enqueued before any login without a user', async () => {
        // The same rule from the other direction: a fact written before a login
        // resolved recorded no user, and it keeps none, so it stays sendable
        // under whatever token the client holds.
        const queue = createQueue();
        await queue.enqueue([envelopeFor('written-by-nobody')]);

        await queue.enqueue([envelopeFor('written-by-nobody')], bob);

        const queued = await queue.peek();
        expect(queued).toHaveLength(1);
        expect(queued[0].user).toBeUndefined();
    });

    it('drops the recorded user with the fact when it is dequeued', async () => {
        const queue = createQueue();
        const envelope = envelopeFor('written-by-alice');
        await queue.enqueue([envelope], alice);

        await queue.dequeue([envelope]);

        expect(await queue.peek()).toEqual([]);
    });
});
