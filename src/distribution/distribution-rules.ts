import { User } from "../model/user";
import { alphaTransform } from "../specification/alpha";
import { describeSpecification } from "../specification/description";
import { buildFeeds } from "../specification/feed-builder";
import { SpecificationOf } from "../specification/model";
import { ExistentialCondition, Match, Specification, SpecificationGiven } from "../specification/specification";
import { SpecificationParser } from "../specification/specification-parser";

interface DistributionRule {
    specification: Specification;
    feeds: Specification[];
    intersectedFeeds: Specification[];
    user: Specification | null;
}

class ShareTarget<T, U> {
    constructor(
        private specification: Specification,
        private rules: DistributionRule[]
    ) {}

    with(user: SpecificationOf<T, User>): DistributionRules {
        const feeds = buildFeeds(this.specification);
        const intersectedFeeds = feeds.map(feed => intersectSpecificationWithDistributionRule(feed, user.specification));

        return new DistributionRules([
            ...this.rules,
            {
                specification: this.specification,
                feeds,
                intersectedFeeds,
                user: user.specification
            }
        ]);
    }

    withEveryone(): DistributionRules {
        const feeds = buildFeeds(this.specification);
        return new DistributionRules([
            ...this.rules,
            {
                specification: this.specification,
                feeds,
                intersectedFeeds: feeds,
                user: null
            }
        ]);
    }
}

export class DistributionRules {
    static empty: DistributionRules = new DistributionRules([]);

    constructor(
        public rules: DistributionRule[]
    ) {}

    with(rules: (r: DistributionRules) => DistributionRules): DistributionRules {
        return rules(this);
    }

    share<T, U>(specification: SpecificationOf<T, U>): ShareTarget<T, U> {
        return new ShareTarget<T, U>(specification.specification, this.rules);
    }

    saveToDescription(): string {
        let description = "distribution {\n";
        for (const rule of this.rules) {
            const specificationDescription = describeSpecification(rule.specification, 1).trimStart();
            const userDescription = rule.user ? describeSpecification(rule.user, 1).trimStart() : "everyone\n";
            description += `    share ${specificationDescription}    with ${userDescription}`;
        }
        description += "}\n";
        return description;
    }

    merge(distributionRules2: DistributionRules): DistributionRules {
        return new DistributionRules([
            ...this.rules,
            ...distributionRules2.rules
        ]);
    }

    public static combine(distributionRules: DistributionRules, specification: Specification, user: Specification | null) {
        const feeds = buildFeeds(specification);
        const intersectedFeeds = user
            ? feeds.map(feed => intersectSpecificationWithDistributionRule(feed, user))
            : feeds;

        return new DistributionRules([
            ...distributionRules.rules,
            {
                specification,
                feeds,
                intersectedFeeds,
                user
            }
        ]);
    }

    static loadFromDescription(description: string): DistributionRules {
        const parser = new SpecificationParser(description);
        parser.skipWhitespace();
        const distributionRules = parser.parseDistributionRules();
        return distributionRules;
    }
}

export function describeDistributionRules(rules: (r: DistributionRules) => DistributionRules): string {
    const distributionRules = rules(new DistributionRules([]));
    return distributionRules.saveToDescription();
}

function intersectSpecificationWithDistributionRule(specification: Specification, ruleSpecification: Specification) {
    if (specification.given.length !== ruleSpecification.given.length) {
        throw new Error("The number of givens in the rule specification must match the number of givens in the original specification.");
    }
    if (!specification.given.every((given, index) => {
        const ruleGiven = ruleSpecification.given[index];
        return given.label.name === ruleGiven.label.name && given.label.type === ruleGiven.label.type;
    })) {
        throw new Error("The givens in the rule specification must match the givens in the original specification.");
    }

    // Ensure that the rule specification projects a user fact.
    const ruleProjection = ruleSpecification.projection;
    if (ruleProjection.type !== 'fact') {
        throw new Error("Distribution rule specification must have a fact projection.");
    }
    const distributionUserMatch = ruleSpecification.matches.find(match => match.unknown.name === ruleProjection.label);
    if (!distributionUserMatch) {
        throw new Error("Distribution rule specification must have a match for the projected user fact.");
    }
    if (distributionUserMatch.unknown.type !== User.Type) {
        throw new Error("Distribution rule specification must project a user fact.");
    }

    // Collect all labels from both specifications to avoid conflicts
    const originalLabels = new Set<string>();
    function collectLabels(spec: Specification) {
        spec.given.forEach(g => originalLabels.add(g.label.name));
        spec.matches.forEach(m => originalLabels.add(m.unknown.name));
        if (spec.projection.type === 'fact') {
            originalLabels.add(spec.projection.label);
        } else if (spec.projection.type === 'composite') {
            spec.projection.components.forEach(c => {
                if (c.type === 'fact' || c.type === 'field' || c.type === 'hash') {
                    originalLabels.add(c.label);
                }
            });
        }
    }
    collectLabels(specification);
    collectLabels(ruleSpecification);

    // Collect unknown labels from rule specification (those not in given)
    const ruleUnknowns = new Set<string>();
    ruleSpecification.matches.forEach(m => {
        if (!ruleSpecification.given.some(g => g.label.name === m.unknown.name)) {
            ruleUnknowns.add(m.unknown.name);
        }
    });

    // Create mapping for alpha transformation with "dist_" prefix
    const mapping: Record<string, string> = {};
    for (const unknown of ruleUnknowns) {
        let newName = "dist_" + unknown;
        let counter = 1;
        while (originalLabels.has(newName)) {
            newName = "dist_" + unknown + counter;
            counter++;
        }
        mapping[unknown] = newName;
        originalLabels.add(newName); // Prevent conflicts with subsequent mappings
    }

    // Apply alpha transformation to rule specification
    const transformedRuleSpec = alphaTransform(ruleSpecification, mapping);

    // Find the distribution user match in the transformed spec
    if (transformedRuleSpec.projection.type !== 'fact') {
        throw new Error("Transformed rule specification must have a fact projection.");
    }
    const transformedDistributionUserMatch = transformedRuleSpec.matches.find(match => match.unknown.name === (transformedRuleSpec.projection as any).label);
    if (!transformedDistributionUserMatch) {
        throw new Error("Transformed rule specification must have a match for the projected user fact.");
    }

    // Replace the distribution user match with one that has an extra path condition:
    // that the distribution user is equal to the `distributionUser` given fact.
    const updatedDistributionUserMatch: Match = {
        ...transformedDistributionUserMatch,
        conditions: [
            ...transformedDistributionUserMatch.conditions,
            {
                type: "path",
                labelRight: "distributionUser",
                rolesLeft: [],
                rolesRight: []
            }
        ]
    };
    const updatedMatches = transformedRuleSpec.matches.map(match => match === transformedDistributionUserMatch ? updatedDistributionUserMatch : match
    );

    // Create an existential condition for the `distributionUser` given.
    // That is, there exists a fact defined by the rule specification where the distribution user
    // match unknown is equal to the `distributionUser` given.
    const existentialCondition: ExistentialCondition = {
        type: "existential",
        exists: true,
        matches: updatedMatches
    };

    // Create a new given that represents the user running the specification.
    const distributionUserGiven: SpecificationGiven = {
        label: {
            name: "distributionUser",
            type: User.Type
        },
        conditions: [existentialCondition]
    };

    // Insert the new given into the original specification's givens.
    const updatedSpecification: Specification = {
        ...specification,
        given: [
            ...specification.given,
            distributionUserGiven
        ]
    };

    return updatedSpecification;
}