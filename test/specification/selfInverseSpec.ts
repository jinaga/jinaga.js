import { Jinaga, JinagaTest, User } from "@src";
import { Company, Office, model, Manager } from "../companyModel";

/**
 * Self-Inverse Restoration Tests (TDD - Red phase)
 *
 * These tests document the expected behavior when the given fact arrives
 * after the subscription has been established. Without self-inverse logic,
 * these tests should fail because there is no listener for the given type.
 */

describe("self-inverse restoration", () => {
  let j: Jinaga;
  let creator: User;
  let company: Company;
  let office: Office;

  beforeEach(() => {
    creator = new User("--- PUBLIC KEY GOES HERE ---");
    company = new Company(creator, "TestCo");
    office = new Office(company, "LateOffice");
  });

  it("should invoke root callback when given arrives after watch (flat projection)", async () => {
    // Given: Start with no Office persisted
    j = JinagaTest.create({ initialState: [creator, company] });

    // A flat specification that projects a field from the given
    const specification = model
      .given(Office)
      .select((o) => o.identifier);

    const received: string[] = [];

    // When: Start watch with an unpersisted given fact
    const observer = j.watch(specification, office, (identifier) => {
      received.push(identifier);
    });

    // Then: Initially nothing is received
    await observer.loaded();
    expect(received).toEqual([]);

    // When: The given fact arrives after subscription
    await j.fact(office);

    // Then: The callback should be invoked with the projection of the given
    expect(received).toEqual(["LateOffice"]);

    observer.stop();
  });

  it("should invoke nested handlers when given arrives then child facts are added", async () => {
    j = JinagaTest.create({ initialState: [creator, company] });

    // Nested specification: Office -> Managers (child collection)
    const specification = model
      .given(Office)
      .match((o, facts) =>
        facts
          .ofType(Manager)
          .join((m) => m.office, o)
          .select((m) => ({ employeeNumber: m.employeeNumber }))
      );

    type ManagerProjection = { employeeNumber: number };
    const employeeNumbers: number[] = [];

    // Start watching before Office is saved
    const observer = j.watch(specification, office, (manager: ManagerProjection) => {
      employeeNumbers.push(manager.employeeNumber);
    });

    await observer.loaded();
    expect(employeeNumbers).toEqual([]);

    // Persist the given Office (should set up reactive context)
    await j.fact(office);

    // Add child facts after given arrives
    await j.fact(new Manager(office, 101));
    await j.fact(new Manager(office, 102));

    // Expect nested callbacks to have been invoked
    expect(employeeNumbers).toEqual([101, 102]);

    observer.stop();
  });
});
