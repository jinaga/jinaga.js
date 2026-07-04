import { DistributionRules, JinagaTest, Trace, User } from "@src";
import { Administrator, Company, model } from "../companyModel";

describe("multi-given distribution rules", () => {
  Trace.off();

  const creator = new User("creator");
  const adminUser = new User("adminUser");
  const otherUser = new User("otherUser");
  const company = new Company(creator, "Foo");
  const administrator = new Administrator(company, adminUser, new Date("2024-01-01"));

  // Share/with rule pair where both share and with specs have two givens
  // (Company, User). The with-spec uses a non-identity match to derive the
  // authorized user via an Administrator fact linking the two givens.
  const distribution = (r: DistributionRules) => r
    .share(model.given(Company, User).match((c, user, facts) =>
      facts.ofType(Administrator)
        .join(a => a.company, c)
        .join(a => a.user, user)
    ))
    .with(model.given(Company, User).match((c, user, facts) =>
      facts.ofType(Administrator)
        .join(a => a.company, c)
        .selectMany(a => facts.ofType(User).join(u => u, a.user))
    ));

  it("should permit an administrator to query their own administrator status", async () => {
    const specification = model.given(Company, User).match((c, user, facts) =>
      facts.ofType(Administrator)
        .join(a => a.company, c)
        .join(a => a.user, user)
    );

    const j = JinagaTest.create({
      model, user: adminUser,
      initialState: [creator, adminUser, company, administrator],
      distribution
    });

    const result = await j.query(specification, company, adminUser);
    expect(result).toHaveLength(1);
  });

  it("should reject a non-administrator querying the administrator status", async () => {
    const specification = model.given(Company, User).match((c, user, facts) =>
      facts.ofType(Administrator)
        .join(a => a.company, c)
        .join(a => a.user, user)
    );

    const j = JinagaTest.create({
      model, user: otherUser,
      initialState: [creator, adminUser, otherUser, company, administrator],
      distribution
    });

    await expect(() => j.query(specification, company, adminUser))
      .rejects.toThrow("Not authorized");
  });

  it("should reject when no user is logged in", async () => {
    const specification = model.given(Company, User).match((c, user, facts) =>
      facts.ofType(Administrator)
        .join(a => a.company, c)
        .join(a => a.user, user)
    );

    const j = JinagaTest.create({
      model, user: undefined,
      initialState: [creator, adminUser, company, administrator],
      distribution
    });

    await expect(() => j.query(specification, company, adminUser))
      .rejects.toThrow("Not authorized");
  });
});
