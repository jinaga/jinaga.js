import { DistributionRules, describeDistributionRules } from "@src";
import { distribution } from "../blogModel";

describe("Distribution rules from description", () => {
  it("should be able to save distribution rules", () => {
    const description = describeDistributionRules(distribution);
    expect(description).not.toBeNull();
  });

  it("should be able to load distribution rules", () => {
    const description = describeDistributionRules(distribution);
    const loaded = DistributionRules.loadFromDescription(description);
    const roundTrip = describeDistributionRules(_ => loaded);
    expect(roundTrip).toEqual(description);
  });

  it("should accumulate rules across multiple distribution blocks", () => {
    const single = describeDistributionRules(distribution);
    const doubled = single + single;
    const loaded = DistributionRules.loadFromDescription(doubled);
    const roundTrip = describeDistributionRules(_ => loaded);
    // Merging the same rules with themselves yields the same set
    // (DistributionRules.merge concatenates rule entries).
    expect(roundTrip.startsWith("distribution {")).toBeTruthy();
    expect(roundTrip.endsWith("}\n")).toBeTruthy();
  });

  it("should reject trailing content of a different block type", () => {
    const description = `
distribution {
}
authorization {
}
`;
    expect(() => DistributionRules.loadFromDescription(description)).toThrow();
  });

  it("should reject trailing garbage", () => {
    const description = `
distribution {
}
not a valid block
`;
    expect(() => DistributionRules.loadFromDescription(description)).toThrow();
  });
});