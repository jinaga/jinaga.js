import { NoOpTracer, Trace, Tracer, User } from "@src";
import { Dehydration } from "../../src/fact/hydrate";
import { MemoryStore } from "../../src/memory/memory-store";
import { ObservableSource, SpecificationListener } from "../../src/observable/observable";
import { FactEnvelope } from "../../src/storage";
import { Company, Manager, Office, model } from "../companyModel";

/**
 * Records messages by the level they were traced at, so a count can be taken
 * per level rather than by matching message text (issue #264).
 */
class RecordingTracer extends NoOpTracer implements Tracer {
    public readonly infos: string[] = [];
    public readonly debugs: string[] = [];
    info(message: string): void {
        this.infos.push(message);
    }
    debug(message: string): void {
        this.debugs.push(message);
    }
}

const creator = new User("--- PUBLIC KEY GOES HERE ---");
const company = new Company(creator, "TestCo");
const office = new Office(company, "TestOffice");

const managersInOffice = model.given(Office).match((office, facts) =>
    facts.ofType(Manager)
        .join(manager => manager.office, office)
).specification;

/**
 * Notify one saved Office fact with `listenerCount` listeners attached to one
 * specification, and report what each level recorded. Everything traced while
 * the listeners are being registered is discarded, so the counts describe the
 * notification alone.
 */
async function notifyWithListeners(tracer: RecordingTracer, listenerCount: number) {
    const store = new MemoryStore();
    const source = new ObservableSource(store);

    const dehydration = new Dehydration();
    dehydration.dehydrate(office);
    const envelopes: FactEnvelope[] = dehydration.factRecords()
        .map(fact => ({ fact, signatures: [] }));
    await store.save(envelopes);

    for (let i = 0; i < listenerCount; i++) {
        source.addSpecificationListener(managersInOffice, async () => { });
    }

    tracer.infos.length = 0;
    tracer.debugs.length = 0;

    const officeEnvelopes = envelopes.filter(envelope => envelope.fact.type === Office.Type);
    expect(officeEnvelopes).toHaveLength(1);
    await source.notify(officeEnvelopes);

    return { infos: tracer.infos.length, debugs: tracer.debugs.length };
}

/**
 * Register `listenerCount` listeners on one specification and then remove all
 * of them, reporting what each level recorded for registration and for removal
 * separately. Nothing is notified here, so the counts describe the lifecycle
 * calls alone (issue #331).
 */
function registerAndRemoveListeners(tracer: RecordingTracer, listenerCount: number) {
    const store = new MemoryStore();
    const source = new ObservableSource(store);

    tracer.infos.length = 0;
    tracer.debugs.length = 0;

    const listeners: SpecificationListener[] = [];
    for (let i = 0; i < listenerCount; i++) {
        listeners.push(source.addSpecificationListener(managersInOffice, async () => { }));
    }
    const registration = { infos: tracer.infos.length, debugs: tracer.debugs.length };

    tracer.infos.length = 0;
    tracer.debugs.length = 0;

    for (const listener of listeners) {
        source.removeSpecificationListener(listener);
    }
    const removal = { infos: tracer.infos.length, debugs: tracer.debugs.length };

    return { registration, removal };
}

describe("notification log volume (issue #264)", () => {
    let tracer: RecordingTracer;

    beforeEach(() => {
        // Trace is global static state, so it must be restored in afterEach.
        tracer = new RecordingTracer();
        Trace.configure(tracer);
    });

    afterEach(() => {
        Trace.setLevel("info");
        Trace.off();
    });

    it("does not grow info output as listeners are added", async () => {
        const few = await notifyWithListeners(tracer, 2);
        const many = await notifyWithListeners(tracer, 16);

        // The aggregate lines describe the notification, not its items, so
        // eight times the listeners must cost the same info volume.
        expect(many.infos).toBe(few.infos);
        expect(few.debugs).toBe(0);
        expect(many.debugs).toBe(0);
    });

    it("keeps the per-listener detail reachable at debug level", async () => {
        Trace.setLevel("debug");

        const few = await notifyWithListeners(tracer, 2);
        const many = await notifyWithListeners(tracer, 16);

        // Demoting the detail must not delete it: it is still there for
        // whoever asks for it, and it is still per listener.
        expect(many.debugs).toBeGreaterThan(few.debugs);
        expect(many.infos).toBe(few.infos);
    });

    it("reports one notification once at info (issue #331)", async () => {
        const { infos } = await notifyWithListeners(tracer, 2);

        // NOTIFY COMPLETE carries everything NOTIFY START carries, so a
        // notification that reported itself twice was reporting it once too
        // many.
        expect(infos).toBe(1);
    });
});

describe("listener lifecycle log volume (issue #331)", () => {
    let tracer: RecordingTracer;

    beforeEach(() => {
        // Trace is global static state, so it must be restored in afterEach.
        tracer = new RecordingTracer();
        Trace.configure(tracer);
    });

    afterEach(() => {
        Trace.setLevel("info");
        Trace.off();
    });

    it("does not grow info output as listeners are registered", () => {
        const few = registerAndRemoveListeners(tracer, 2);
        const many = registerAndRemoveListeners(tracer, 16);

        // Registration is a per-listener event, so a reconnect that
        // re-subscribes must not cost info lines in proportion to its
        // subscriptions.
        expect(many.registration.infos).toBe(few.registration.infos);
        expect(few.registration.debugs).toBe(0);
        expect(many.registration.debugs).toBe(0);
    });

    it("does not grow info output as listeners are removed", () => {
        const few = registerAndRemoveListeners(tracer, 2);
        const many = registerAndRemoveListeners(tracer, 16);

        // Removal is a per-listener event too, and a disconnect unsubscribes
        // everything the connection held.
        expect(many.removal.infos).toBe(few.removal.infos);
        expect(few.removal.debugs).toBe(0);
        expect(many.removal.debugs).toBe(0);
    });

    it("keeps the registration and removal detail reachable at debug level", () => {
        Trace.setLevel("debug");

        const few = registerAndRemoveListeners(tracer, 2);
        const many = registerAndRemoveListeners(tracer, 16);

        // Demoting the detail must not delete it: it is still there for
        // whoever asks for it, and it is still per listener.
        expect(many.registration.debugs).toBeGreaterThan(few.registration.debugs);
        expect(many.removal.debugs).toBeGreaterThan(few.removal.debugs);
        expect(many.registration.infos).toBe(few.registration.infos);
        expect(many.removal.infos).toBe(few.removal.infos);
    });
});
