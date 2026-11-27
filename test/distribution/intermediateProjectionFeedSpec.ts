import { DistributionEngine, DistributionRules, FactEnvelope, FactRecord, HashMap, JinagaTest, MemoryStore, Trace, User, buildFeeds, dehydrateFact } from "@src";
import { Administrator, Competitor, Event, Finalist, Tenant, distribution, finalistsOfEvent, model } from "../vectors/models/intermediate-projection";

// The model, the share rule and its target are written in
// `test/vectors/models/intermediate-projection.ts`, which is also where
// `npm run vectors` reads them from (#387).

// Regression for issue #204: a distribution rule whose `.select()` projection
// traverses *through* an intermediate fact (without exposing it as its own
// named component) should let an authorized user run a direct query for that
// intermediate fact under JinagaTest. The real replicator delivers those
// intermediate facts into the client's local store as a side effect of the
// projection feed, so direct queries there succeed; JinagaTest must mirror it
// without forcing the app to declare redundant flat rules.

describe("distribution rules with intermediate projection facts (issue #204)", () => {
  Trace.off();

  const tenantUser = new User("tenant-key");
  const tenant = new Tenant(tenantUser);
  const adminUser = new User("admin-key");
  const administrator = new Administrator(tenant, adminUser);
  const outsider = new User("outsider-key");
  const event = new Event(tenant, "event-id");
  const competitor = new Competitor(tenant);
  const finalist = new Finalist(competitor, event);

  const initialState = [
    tenantUser, tenant, adminUser, administrator, outsider, event, competitor, finalist
  ];

  function loggedIn(user: User | undefined) {
    return JinagaTest.create({ model, user, initialState, distribution });
  }

  it("authorizes a direct query for an intermediate fact of a projection rule", async () => {
    const j = loggedIn(adminUser);
    const results = await j.query(finalistsOfEvent, event);
    expect(results).toHaveLength(1);
  });

  it("authorizes a direct query for a deeper intermediate fact (Competitor)", async () => {
    const j = loggedIn(adminUser);
    const competitorsOfEvent = model.given(Event).match((event, facts) =>
      facts.ofType(Finalist)
        .join(finalist => finalist.event, event)
        .selectMany(finalist => finalist.competitor.predecessor())
    );
    const results = await j.query(competitorsOfEvent, event);
    expect(results).toHaveLength(1);
  });

  it("still rejects an unauthorized user querying the same intermediate fact", async () => {
    const j = loggedIn(outsider);
    await expect(j.query(finalistsOfEvent, event)).rejects.toThrow("Not authorized");
  });

  it("still rejects a feed that is not a sub-path of any rule", async () => {
    const j = loggedIn(adminUser);
    // Administrators are not shared; a direct query for them is unrelated to
    // the only share rule (which projects finalist/competitor data).
    const administratorsOfTenant = model.given(Tenant).match((tenant, facts) =>
      facts.ofType(Administrator).join(a => a.tenant, tenant)
    );
    await expect(j.query(administratorsOfTenant, tenant)).rejects.toThrow("Not authorized");
  });

  // The same DistributionEngine backs the real replicator (jinaga-server),
  // which constructs it with isTest=false. Assert the relaxation applies there
  // too, so a passing JinagaTest predicts the replicator's behavior.
  it("authorizes the intermediate feed through the replicator engine (isTest=false)", async () => {
    const store = await storeWith(tenantUser, tenant, adminUser, administrator, event, competitor, finalist);
    const engine = new DistributionEngine(distribution(new DistributionRules([])), store, false);

    // Mirror jinaga-server's authorization path: build feeds from the spec and
    // key the start by the spec's (normalized) given labels.
    const specification = finalistsOfEvent.specification;
    const feeds = buildFeeds(specification);
    const namedStart = namedStartFor(specification, factReference(event));

    const result = await engine.canDistributeToAll(feeds, namedStart, factReference(adminUser));
    expect(result.type).toBe("success");
  });
});

function factReference(fact: HashMap): FactRecord {
  const records = dehydrateFact(fact);
  return records[records.length - 1];
}

function namedStartFor(specification: { given: { label: { name: string } }[] }, ...references: FactRecord[]) {
  return specification.given.reduce((map, given, index) => ({
    ...map,
    [given.label.name]: references[index]
  }), {} as { [name: string]: FactRecord });
}

async function storeWith(...facts: HashMap[]): Promise<MemoryStore> {
  const store = new MemoryStore();
  const records = new Map<string, FactRecord>();
  for (const fact of facts) {
    for (const record of dehydrateFact(fact)) {
      records.set(`${record.type}:${record.hash}`, record);
    }
  }
  const envelopes: FactEnvelope[] = Array.from(records.values()).map(fact => ({ fact, signatures: [] }));
  await store.save(envelopes);
  return store;
}
