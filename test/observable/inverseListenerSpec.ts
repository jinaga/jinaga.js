import { User } from "@src";
import { Dehydration } from "../../src/fact/hydrate";
import { MemoryStore } from "../../src/memory/memory-store";
import { ObservableSource } from "../../src/observable/observable";
import { candidateInverses } from "../../src/specification/inverse-candidates";
import { invertSpecification } from "../../src/specification/inverse";
import { Specification } from "../../src/specification/specification";
import { SpecificationParser } from "../../src/specification/specification-parser";
import { FactEnvelope, FactRecord, FactReference, ProjectedResult } from "../../src/storage";

class Channel {
    static Type = "Chat.Channel" as const;
    type = Channel.Type;
    constructor(
        public creator: User,
        public name: string
    ) { }
}

class Message {
    static Type = "Chat.Message" as const;
    type = Message.Type;
    constructor(
        public channel: Channel,
        public text: string
    ) { }
}

class Read {
    static Type = "Chat.Read" as const;
    type = Read.Type;
    constructor(
        public message: Message,
        public user: User
    ) { }
}

function parse(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

/**
 * Issue #141's shape: `p1` is joined only from inside the negated existential
 * condition, so no inverse can reach it from the new fact alone.
 */
const unreadMessages = parse(`
(p1: Jinaga.User, p2: Chat.Channel) {
    m: Chat.Message [
        m->channel: Chat.Channel = p2
        !E {
            r: Chat.Read [
                r->message: Chat.Message = m
                r->user: Jinaga.User = p1
            ]
        }
    ]
}`);

const alice = new User("--- ALICE ---");
const bob = new User("--- BOB ---");
const general = new Channel(alice, "general");
const random = new Channel(alice, "random");
const generalMessage = new Message(general, "in general");
const laterGeneralMessage = new Message(general, "also in general");
const randomMessage = new Message(random, "in random");

/** The pin is the inverse's last given; its type is what the listener waits for. */
function pinType(inverse: Specification): string {
    return inverse.given[inverse.given.length - 1].label.type;
}

/**
 * The inverse that waits for a `Read`. It is the one this subscription needs
 * and the one `invertSpecification` cannot express: it reaches `p1` through
 * the negated condition the new fact arrives in.
 */
function readInverse(): Specification {
    const inverses = candidateInverses(unreadMessages).filter(i => pinType(i) === Read.Type);
    expect(inverses.length).toBeGreaterThan(0);
    return inverses[0];
}

/** Dehydrate `fact`, with its predecessors, and keep only its own record. */
function recordOf(fact: {}): FactRecord {
    const dehydration = new Dehydration();
    const reference = dehydration.dehydrate(fact);
    return dehydration.factRecords().find(r =>
        r.type === reference.type && r.hash === reference.hash)!;
}

function envelopeOf(fact: {}): FactEnvelope {
    return { fact: recordOf(fact), signatures: [] };
}

interface Harness {
    store: MemoryStore;
    source: ObservableSource;
    reads: FactReference[][];
    ref(fact: {}): FactReference;
}

/**
 * A store holding both channels and their messages, and an `ObservableSource`
 * over it whose reads are recorded. Nothing is read or notified by the setup
 * itself, so a read recorded afterwards came from a notification.
 */
async function harness(): Promise<Harness> {
    const dehydration = new Dehydration();
    const references = new Map<{}, FactReference>();
    for (const fact of [alice, bob, general, random, generalMessage, laterGeneralMessage, randomMessage]) {
        references.set(fact, dehydration.dehydrate(fact));
    }
    const store = new MemoryStore();
    await store.save(dehydration.factRecords().map(fact => <FactEnvelope>{ fact, signatures: [] }));

    const reads: FactReference[][] = [];
    const read = store.read.bind(store);
    jest.spyOn(store, "read").mockImplementation((start, specification) => {
        reads.push(start);
        return read(start, specification);
    });

    return {
        store,
        source: new ObservableSource(store),
        reads,
        ref: fact => references.get(fact)!
    };
}

/**
 * Save a fact, then notify it, in that order. `FactManager.save` does the
 * same, and the order matters: an inverse reads the new fact's predecessors
 * out of the store.
 */
async function deliver({ store, source }: Harness, fact: {}): Promise<void> {
    const envelope = envelopeOf(fact);
    await store.save([envelope]);
    await source.notify([envelope]);
}

/** How many distinct `start` prefixes the recorded reads used for their givens. */
function distinctGivens(reads: FactReference[][]): number {
    const signatures = reads.map(start =>
        start.slice(0, start.length - 1).map(r => `${r.type}:${r.hash}`).join(","));
    return new Set(signatures).size;
}

describe("addInverseListener", () => {
    it("delivers a row for a specification invertSpecification refuses", async () => {
        // The reason this issue exists: addSpecificationListener could never
        // carry this specification, because inverting it fails outright.
        expect(() => invertSpecification(unreadMessages)).toThrow();

        const h = await harness();
        const { source, ref } = h;
        const delivered: ProjectedResult[] = [];
        const inverses = candidateInverses(unreadMessages);
        expect(inverses.length).toBeGreaterThan(0);
        for (const inverse of inverses) {
            source.addInverseListener(inverse, [ref(alice), ref(general)], async results => {
                delivered.push(...results);
            });
        }

        await deliver(h, new Read(generalMessage, alice));

        // The message leaves the result when alice reads it, so its tuple is
        // the change this subscription has to hear about.
        expect(delivered.map(result => result.tuple.m)).toContainEqual(ref(generalMessage));
    });

    it("reads once per distinct givens, not once per listener", async () => {
        const h = await harness();
        const { source, reads, ref } = h;
        const inverse = readInverse();

        const forGeneral: ProjectedResult[] = [];
        const alsoForGeneral: ProjectedResult[] = [];
        const forRandom: ProjectedResult[] = [];
        source.addInverseListener(inverse, [ref(alice), ref(general)], async results => {
            forGeneral.push(...results);
        });
        source.addInverseListener(inverse, [ref(alice), ref(general)], async results => {
            alsoForGeneral.push(...results);
        });
        source.addInverseListener(inverse, [ref(alice), ref(random)], async results => {
            forRandom.push(...results);
        });

        await deliver(h, new Read(generalMessage, alice));

        // Three listeners, two sets of givens: the two that share givens share
        // a read, so the inverse is read twice rather than three times.
        expect(reads.length).toBe(2);
        expect(distinctGivens(reads)).toBe(2);

        // Each listener sees only what its own givens select, with nothing
        // left for it to filter out.
        expect(forGeneral.map(result => result.tuple.m)).toContainEqual(ref(generalMessage));
        expect(alsoForGeneral.map(result => result.tuple.m)).toContainEqual(ref(generalMessage));
        expect(forRandom).toEqual([]);
    });

    it("reads nothing and notifies no one for a fact of another type", async () => {
        const h = await harness();
        const { source, reads, ref } = h;
        let called = 0;
        source.addInverseListener(readInverse(), [ref(alice), ref(general)], async () => {
            called++;
        });

        await deliver(h, new Message(general, "a message, not a read"));

        expect(reads).toEqual([]);
        expect(called).toBe(0);
    });

    it("stops delivering after removeInverseListener", async () => {
        const h = await harness();
        const { source, ref } = h;
        const delivered: ProjectedResult[] = [];
        const listener = source.addInverseListener(readInverse(), [ref(alice), ref(general)], async results => {
            delivered.push(...results);
        });

        await deliver(h, new Read(generalMessage, alice));
        expect(delivered.map(result => result.tuple.m)).toContainEqual(ref(generalMessage));

        source.removeInverseListener(listener);
        // A fact this listener would have heard about while registered.
        await deliver(h, new Read(laterGeneralMessage, alice));

        expect(delivered.map(result => result.tuple.m)).not.toContainEqual(ref(laterGeneralMessage));
    });
});
