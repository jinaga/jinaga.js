import { NoOpTracer, Trace, Tracer, User } from "@src";
import { Dehydration } from "../../src/fact/hydrate";
import { MemoryStore } from "../../src/memory/memory-store";
import { ObservableSource } from "../../src/observable/observable";
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
});
