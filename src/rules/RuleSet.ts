import { AuthorizationRules } from "../authorization/authorizationRules";
import { DistributionRules } from "../distribution/distribution-rules";
import { PurgeConditions } from "../purge/purgeConditions";
import { SpecificationParser } from "../specification/specification-parser";

export class RuleSet {
    static empty: RuleSet = new RuleSet(
        AuthorizationRules.empty,
        DistributionRules.empty,
        PurgeConditions.empty
    );

    constructor(
        public authorizationRules: AuthorizationRules,
        public distributionRules: DistributionRules,
        public purgeConditions: PurgeConditions
    ) {}

    public static loadFromDescription(description: string): RuleSet {
        const parser = new SpecificationParser(description);
        parser.skipWhitespace();
        let authorizationRules: AuthorizationRules = AuthorizationRules.empty;
        let distributionRules: DistributionRules = DistributionRules.empty;
        let purgeConditions: PurgeConditions = PurgeConditions.empty;
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

    merge(ruleSet2: RuleSet): RuleSet {
        return new RuleSet(
            this.authorizationRules.merge(ruleSet2.authorizationRules),
            this.distributionRules.merge(ruleSet2.distributionRules),
            this.purgeConditions.merge(ruleSet2.purgeConditions)
        );
    }
}