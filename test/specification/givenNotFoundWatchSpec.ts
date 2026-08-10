import {
    AuthenticationNoOp,
    FactEnvelope,
    FactManager,
    FactReference,
    FeedResponse,
    FeedsResponse,
    Jinaga,
    JinagaTest,
    MemoryStore,
    ObservableSource,
    PassThroughFork,
    ReadDiagnostic,
    Specification,
    User,
} from "@src";
import { Network } from "../../src/managers/NetworkManager";
import { Company, Office, model } from "../companyModel";
import { asGivenNotFound } from "../distribution/diagnosticNarrowing";

const officesOfCompany = model.given(Company).match((company, facts) =>
    facts.ofType(Office)
        .join(office => office.company, company)
);

/**
 * A Network double that stands in for a replicator: it answers `feeds` and so
 * could, in principle, supply a fact the local store is missing.
 */
class RemoteNetwork implements Network {
    readonly canLoad = true;

    feeds(_start: FactReference[], _specification: Specification): Promise<FeedsResponse> {
        return Promise.resolve({ feeds: ["feed-hash"] });
    }

    fetchFeed(_feed: string, bookmark: string): Promise<FeedResponse> {
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(
        _feed: string,
        bookmark: string,
        onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>,
        _onError: (err: Error) => void,
        _feedRefreshIntervalSeconds: number
    ): () => void {
        Promise.resolve().then(() => onResponse([], bookmark));
        return () => { };
    }

    load(_factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }
}

/**
 * Issue #232, the watch half. A subscription has a "later" in which the given
 * may arrive, so it never throws and never rejects `cached()` or `loaded()`.
 * The condition is reported on the diagnostic channel instead, and retires
 * itself when results start flowing.
 */
describe("given-not-found on watch (issue #232)", () => {
    let creator: User;
    let company: Company;
    let j: Jinaga;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        // Deliberately withholding the company: the given is absent.
        j = JinagaTest.create({ initialState: [creator] });
    });

    it("reports the missing given without throwing", async () => {
        const companyRef = j.factReference(Company, j.hash(company));
        const received: ReadDiagnostic[] = [];

        const observer = j.watch(officesOfCompany, companyRef, () => { });
        observer.onDiagnostic(d => received.push(d));
        await observer.loaded();

        expect(received).toHaveLength(1);
        const diagnostic = asGivenNotFound(received[0]);
        expect(diagnostic.operation).toBe("watch");
        expect(diagnostic.references[0].hash).toBe(j.hash(company));
        expect(diagnostic.cleared).toBeFalsy();

        observer.stop();
    });

    it("leaves cached() and loaded() alone", async () => {
        const companyRef = j.factReference(Company, j.hash(company));

        const observer = j.watch(officesOfCompany, companyRef, () => { });

        // Neither promise rejects: the machinery is fine, only the data is
        // missing, and those two channels report machinery.
        await expect(observer.cached()).resolves.toBe(false);
        await expect(observer.loaded()).resolves.toBeUndefined();

        observer.stop();
    });

    it("replays the diagnostic to a handler registered after loading", async () => {
        const companyRef = j.factReference(Company, j.hash(company));

        const observer = j.watch(officesOfCompany, companyRef, () => { });
        await observer.loaded();

        const received: ReadDiagnostic[] = [];
        observer.onDiagnostic(d => received.push(d));

        expect(received).toHaveLength(1);
        expect(asGivenNotFound(received[0]).references[0].hash).toBe(j.hash(company));
        expect(observer.diagnostics()).toHaveLength(1);

        observer.stop();
    });

    it("clears the diagnostic once the given materializes and results flow", async () => {
        const companyRef = j.factReference(Company, j.hash(company));
        const received: ReadDiagnostic[] = [];
        const offices: string[] = [];

        const observer = j.watch(officesOfCompany, companyRef, office => {
            offices.push(office.identifier);
        });
        observer.onDiagnostic(d => received.push(d));
        await observer.loaded();

        expect(received).toHaveLength(1);
        expect(offices).toEqual([]);

        // The given arrives, then a matching successor.
        await j.fact(company);
        await j.fact(new Office(company, "TestOffice"));
        await observer.processed();

        expect(offices).toEqual(["TestOffice"]);
        expect(received).toHaveLength(2);
        const clearing = asGivenNotFound(received[1]);
        expect(clearing.cleared).toBe(true);
        expect(clearing.references[0].hash).toBe(j.hash(company));

        observer.stop();
    });

    it("reports operation 'subscribe' for a keep-alive subscription", async () => {
        const companyRef = j.factReference(Company, j.hash(company));
        const received: ReadDiagnostic[] = [];

        const observer = j.subscribe(officesOfCompany, companyRef, () => { });
        observer.onDiagnostic(d => received.push(d));
        await observer.loaded();

        expect(received).toHaveLength(1);
        expect(asGivenNotFound(received[0]).operation).toBe("subscribe");

        observer.stop();
    });

    it("stays silent when a replicator was consulted", async () => {
        // The replicator evaluated the specification from this given and
        // returned nothing. That answer holds whether or not the given is
        // locally resident, so there is nothing to report.
        const store = new MemoryStore();
        const remote = new Jinaga(
            new AuthenticationNoOp(),
            new FactManager(
                new PassThroughFork(store),
                new ObservableSource(store),
                store,
                new RemoteNetwork(),
                []),
            null);
        const companyRef = remote.factReference(Company, remote.hash(company));
        const received: ReadDiagnostic[] = [];

        const observer = remote.watch(officesOfCompany, companyRef, () => { });
        observer.onDiagnostic(d => received.push(d));
        await observer.loaded();

        expect(received).toEqual([]);

        observer.stop();
    });

    it("stays silent on query when a replicator was consulted", async () => {
        const store = new MemoryStore();
        const remote = new Jinaga(
            new AuthenticationNoOp(),
            new FactManager(
                new PassThroughFork(store),
                new ObservableSource(store),
                store,
                new RemoteNetwork(),
                []),
            null);
        const companyRef = remote.factReference(Company, remote.hash(company));

        // Does not throw, precisely because the replicator answered.
        await expect(remote.query(officesOfCompany, companyRef)).resolves.toEqual([]);
    });
});
