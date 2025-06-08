import { computeHash, verifyHash } from '../../src/fact/hash';
import { dehydrateFact, Hydration } from '../../src/fact/hydrate';
import { JinagaTest } from '../../src/jinaga-test';

describe ('Hash', () => {
    it('should be independent of field order', () => {
        const hash1 = computeHash({
            a: 'one',
            b: 'two'
        }, {});
        const hash2 = computeHash({
            b: 'two',
            a: 'one'
        }, {});
        
        expect(hash1).toEqual(hash2);
    });
    
    it('should be independent of array order', () => {
        const one = {
            type: 'pred', hash: 'one'
        };
        const two = {
            type: 'pred', hash: 'two'
        };
        const hash1 = computeHash({}, {
            preds: [ one, two ]
        });
        const hash2 = computeHash({}, {
            preds: [ two, one ]
        });
        
        expect(hash1).toEqual(hash2);
    });

    it('should verify hash', () => {
        const records = dehydrateFact({
            type: 'Child',
            parent: {
                type: 'Parent',
                identifier: 'fee'
            },
            value: 'fum'
        });

        expect(verifyHash(records[0])).toBeTruthy();
        expect(verifyHash(records[1])).toBeTruthy();
    })
});

describe('Nullable Predecessors', () => {
    it('should create fact with null predecessor and omit it from canonical form', () => {
        // Given a fact with a null predecessor
        const factWithNullPredecessor = {
            type: 'ChildWithOptionalParent',
            parent: null,
            name: 'orphan'
        };

        // When dehydrating the fact
        const records = dehydrateFact(factWithNullPredecessor);

        // Then no exception should be thrown during creation
        expect(records).toBeDefined();
        expect(records.length).toBe(1);

        // And the canonical form should omit the null predecessor
        const record = records[0];
        expect(record.predecessors).toEqual({});
        expect(record.fields).toEqual({ name: 'orphan' });
        expect(record.type).toBe('ChildWithOptionalParent');

        // And deserialization should result in the property being undefined
        const hydration = new Hydration(records);
        const hydratedFact = hydration.hydrate({ type: record.type, hash: record.hash });
        expect(hydratedFact.parent).toBeUndefined();
        expect(hydratedFact.name).toBe('orphan');
        expect(hydratedFact.type).toBe('ChildWithOptionalParent');
    });

    it('should create fact with undefined predecessor and omit it from canonical form', () => {
        // Given a fact with an undefined predecessor
        const factWithUndefinedPredecessor = {
            type: 'ChildWithOptionalParent',
            parent: undefined,
            name: 'orphan'
        };

        // When dehydrating the fact
        const records = dehydrateFact(factWithUndefinedPredecessor);

        // Then no exception should be thrown during creation
        expect(records).toBeDefined();
        expect(records.length).toBe(1);

        // And the canonical form should omit the undefined predecessor
        const record = records[0];
        expect(record.predecessors).toEqual({});
        expect(record.fields).toEqual({ name: 'orphan' });
        expect(record.type).toBe('ChildWithOptionalParent');

        // And deserialization should result in the property being undefined
        const hydration = new Hydration(records);
        const hydratedFact = hydration.hydrate({ type: record.type, hash: record.hash });
        expect(hydratedFact.parent).toBeUndefined();
        expect(hydratedFact.name).toBe('orphan');
        expect(hydratedFact.type).toBe('ChildWithOptionalParent');
    });
});

describe('Fact Validation', () => {
    it('should omit predecessor when fact contains null predecessor', async () => {
        // Given a Jinaga instance
        const j = JinagaTest.create({});

        // When attempting to create a fact with a null predecessor
        const factWithNullPredecessor = {
            type: 'ChildWithNullParent',
            parent: null,
            name: 'non-parented child'
        };

        // Then the fact should be created, and the null predecessor should be omitted
        const createdFact = await j.fact(factWithNullPredecessor);
        expect(createdFact).toBeDefined();
        expect(createdFact.type).toBe('ChildWithNullParent');
        expect(createdFact.parent).toBeUndefined();
        expect(createdFact.name).toBe('non-parented child');
    });
});