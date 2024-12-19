import { AuthorizationRules } from "../authorization/authorizationRules";
import { DistributionRules } from "../distribution/distribution-rules";
import { PurgeConditions } from "../purge/purgeConditions";
import { SpecificationParser } from "../specification/specification-parser";

export class RuleSet {
    constructor(
        public authorizationRules: AuthorizationRules,
        public distributionRules: DistributionRules,
        public purgeConditions: PurgeConditions
    ) {}

    public static loadFromDescription(description: string): RuleSet {
        const parser = new SpecificationParser(description);
        parser.skipWhitespace();
        let authorizationRules: AuthorizationRules = new AuthorizationRules(undefined);
        let distributionRules: DistributionRules = new DistributionRules([]);
        let purgeConditions: PurgeConditions = new PurgeConditions([]);
        while (!parser.atEnd()) {
            if (parser.continues("authorization")) {
                authorizationRules = authorizationRules.with(a => parser.parseAuthorizationRules());
            }
            else if (parser.continues("distribution")) {
                distributionRules = distributionRules.with(d => parser.parseDistributionRules());
            }
            else if (parser.continues("purge")) {
                throw new Error("Purge conditions are not yet implemented");
            }
            else {
                // Throws an error.
                parser.expectEnd();
            }
        }
        return new RuleSet(authorizationRules, distributionRules, purgeConditions);
    }
}