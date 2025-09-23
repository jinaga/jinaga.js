"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
const blogModel_1 = require("../blogModel");
describe("Distribution rules from description", () => {
    it("should be able to save distribution rules", () => {
        const description = (0, _src_1.describeDistributionRules)(blogModel_1.distribution);
        expect(description).not.toBeNull();
    });
    it("should be able to load distribution rules", () => {
        const description = (0, _src_1.describeDistributionRules)(blogModel_1.distribution);
        const loaded = _src_1.DistributionRules.loadFromDescription(description);
        const roundTrip = (0, _src_1.describeDistributionRules)(_ => loaded);
        expect(roundTrip).toEqual(description);
    });
});
//# sourceMappingURL=distributionDescriptionSpec.js.map