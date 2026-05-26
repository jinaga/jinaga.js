import { DistributionRules, JinagaTest, Trace, User } from "@src";
import { Company, Office, OfficeClosed, model } from "../companyModel";

describe("distribution authorizes negating feeds for .notExists()", () => {
  Trace.off();

  const creator = new User("creator");
  const outsider = new User("outsider");
  const company = new Company(creator, "Co");
  const office = new Office(company, "Office");

  describe("when each fact type is independently shared with everyone", () => {
    // Two rules that share constituents independently. A spec with .notExists()
    // produces a "negating feed" (Company → Office → OfficeClosed) that no
    // single rule covers, plus the outer feed (Company → Office, with !E).
    // Both should be authorized via composition.
    const distribution = (r: DistributionRules) => r
      .share(model.given(Company).match((c, facts) =>
        facts.ofType(Office).join(o => o.company, c)
      )).withEveryone()
      .share(model.given(Office).match((o, facts) =>
        facts.ofType(OfficeClosed).join(oc => oc.office, o)
      )).withEveryone();

    it("authorizes a .notExists() spec for a logged-in user", async () => {
      const spec = model.given(Company).match((c, facts) =>
        facts.ofType(Office).join(o => o.company, c)
          .notExists(o => facts.ofType(OfficeClosed).join(oc => oc.office, o))
      );

      const j = JinagaTest.create({
        model, user: outsider,
        initialState: [creator, outsider, company, office],
        distribution
      });
      const result = await j.query(spec, company);
      expect(result).toHaveLength(1);
    });

    it("authorizes a .notExists() spec when no user is logged in", async () => {
      const spec = model.given(Company).match((c, facts) =>
        facts.ofType(Office).join(o => o.company, c)
          .notExists(o => facts.ofType(OfficeClosed).join(oc => oc.office, o))
      );

      const j = JinagaTest.create({
        model, user: undefined,
        initialState: [creator, company, office],
        distribution
      });
      const result = await j.query(spec, company);
      expect(result).toHaveLength(1);
    });
  });

  describe("when only one rule covers part of the spec", () => {
    // Only the outer fact type is shared. The inner branch of .notExists()
    // is not authorized — composition should fail.
    const distribution = (r: DistributionRules) => r
      .share(model.given(Company).match((c, facts) =>
        facts.ofType(Office).join(o => o.company, c)
      )).withEveryone();

    it("rejects when the negated fact type has no covering rule", async () => {
      const spec = model.given(Company).match((c, facts) =>
        facts.ofType(Office).join(o => o.company, c)
          .notExists(o => facts.ofType(OfficeClosed).join(oc => oc.office, o))
      );

      const j = JinagaTest.create({
        model, user: outsider,
        initialState: [creator, outsider, company, office],
        distribution
      });
      await expect(() => j.query(spec, company))
        .rejects.toThrow("Not authorized");
    });
  });
});
