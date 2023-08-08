import { describeDistributionRules } from "../../src/distribution/distribution-rules";
import { distribution } from "../blogModel";

describe("Distribution rules from description", () => {
  it("should be able to save distribution rules", () => {
    const description = describeDistributionRules(distribution);
    expect(description).not.toBeNull();
  });
});