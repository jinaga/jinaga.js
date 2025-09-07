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
});