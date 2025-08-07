import { Jinaga, JinagaTest, Specification, SpecificationParser, validateSpecificationConnectivity, User } from "../../src";
import { Company, Employee, Office, OfficeClosed, President, model } from "../companyModel";

function parseSpec(input: string): Specification {
  const parser = new SpecificationParser(input);
  parser.skipWhitespace();
  return parser.parseSpecification();
}

describe("specification connectivity", () => {
  let j: Jinaga;
  let company: Company;
  let office: Office;
  let closed: OfficeClosed;
  let president: President;

  beforeEach(() => {
    // Build a standard test graph using existing model
    const user = new User("--- USER ---");
    company = new Company(user, "ACME");
    office = new Office(company, "HQ");
    closed = new OfficeClosed(office, new Date());
    president = new President(office, user);

    j = JinagaTest.create({ initialState: [ user, company, office, closed, president ] });
  });

  describe("builder", () => {
    it("passes when connected by path condition", async () => {
      const spec = model.given(Company).match((c, facts) =>
        facts.ofType(Office).join(o => o.company, c)
      );

      const result = await j.query(spec, company);
      expect(result.length).toBeGreaterThan(0);
    });

    it("passes with existential condition connected to the match unknown", async () => {
      const spec = model.given(Company).match((c, facts) =>
        facts.ofType(Office).join(o => o.company, c)
          .exists(off => facts.ofType(OfficeClosed).join(oc => oc.office, off))
      );

      const result = await j.query(spec, company);
      expect(result.length).toBeGreaterThan(0);
    });

    it("passes with nested specification component connected to outer labels", async () => {
      const spec = model.given(Company).match((c, facts) =>
        facts.ofType(Office).join(o => o.company, c)
          .select(off => ({
            office: off,
            closures: facts.ofType(OfficeClosed).join(oc => oc.office, off)
          }))
      );

      const result = await j.query(spec, company);
      expect(result.length).toBeGreaterThan(0);
    });

    it("validator flags when projection references a disconnected given label", async () => {
      const spec = model.given(Company, Office).match((c, p2, facts) =>
        facts.ofType(Office).join(o => o.company, c)
          .select(() => ({ otherOffice: p2 }))
      );

      expect(() => validateSpecificationConnectivity(spec.specification)).toThrow(/disconnected/i);
    });

    it("validator flags when a given is unused (isolated component)", () => {
      const spec = model.given(Company, Office).select((c, p2) => ({ company: c }));
      expect(() => validateSpecificationConnectivity(spec.specification)).toThrow(/disconnected/i);
    });
  });

  describe("DSL", () => {
    it("passes when connected by path condition", () => {
      const spec = parseSpec(`
        (c: Company) {
          o: Office [ o->company:Company = c ]
        } => o
      `);
      // parseSpecification already validates connectivity
      expect(() => validateSpecificationConnectivity(spec)).not.toThrow();
    });

    it("passes with existential condition", () => {
      const spec = parseSpec(`
        (c: Company) {
          o: Office [
            o->company:Company = c
            E {
              e: Office.Closed [ e->office:Office = o ]
            }
          ]
        } => o
      `);
      expect(() => validateSpecificationConnectivity(spec)).not.toThrow();
    });

    it("passes with nested specification in projection that references outer label", () => {
      const spec = parseSpec(`
        (c: Company) {
          o: Office [ o->company:Company = c ]
        } => { offices = { oc: Office.Closed [ oc->office:Office = o ] } => oc }
      `);
      expect(() => validateSpecificationConnectivity(spec)).not.toThrow();
    });

    it("throws when projection references a disconnected label", () => {
      const spec = parseSpec(`
        (p1: Player, p2: Playground) {
          j: Join [ j->player:Player = p1 ]
        } => p2
      `);
      expect(() => validateSpecificationConnectivity(spec)).toThrow(/disconnected/i);
    });

    it("throws when a given is entirely unused", () => {
      const spec = parseSpec(`
        (a: A, b: B) { } => a
      `);
      expect(() => validateSpecificationConnectivity(spec)).toThrow(/disconnected/i);
    });

    it("throws when projection references labels from multiple components", () => {
      const spec = parseSpec(`
        (p1: P1, p2: P2) {
          u1: U1 [ u1->p1:P1 = p1 ]
          u2: U2 [ u2->p2:P2 = p2 ]
        } => { a = p1 b = p2 }
      `);
      expect(() => validateSpecificationConnectivity(spec)).toThrow(/multiple components/i);
    });
  });
});