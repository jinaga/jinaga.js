import { User } from "../model/user";
import { describeSpecification } from "../specification/description";
import { buildFeeds } from "../specification/feed-builder";
import { SpecificationOf } from "../specification/model";
import { Specification } from "../specification/specification";
import { SpecificationParser } from "../specification/specification-parser";
import { DistributionEngine } from "./distribution-engine";

interface DistributionRule {
  specification: Specification;
  feeds: Specification[];
  intersectedSpecifications?: Specification[];
  user: Specification | null;
}

class ShareTarget<T, U> {
  constructor(
    private specification: Specification,
    private rules: DistributionRule[]
  ) { }

  with(user: SpecificationOf<T, User>): DistributionRules {
    const engine = new DistributionEngine(new DistributionRules(this.rules));
    const intersectedSpecifications: Specification[] = [];

    for (const rule of this.rules) {
      if (rule.user !== null) {
        try {
          const intersected = engine.intersectSpecificationWithDistributionRule(this.specification, rule.user);
          intersectedSpecifications.push(intersected);
        } catch {
          // If intersection fails, use the shared specification as intersected
          intersectedSpecifications.push(this.specification);
        }
      } else {
        // For withEveryone rules, no intersection
        intersectedSpecifications.push(this.specification);
      }
    }

    if (this.rules.length === 0) {
      // No existing rules
      intersectedSpecifications.push(this.specification);
    }

    return new DistributionRules([
      ...this.rules,
      {
        specification: this.specification,
        feeds: buildFeeds(this.specification),
        intersectedSpecifications,
        user: user.specification
      }
    ]);
  }

  withEveryone(): DistributionRules {
    const engine = new DistributionEngine(new DistributionRules(this.rules));
    const intersectedSpecifications: Specification[] = [];

    for (const rule of this.rules) {
      if (rule.user !== null) {
        try {
          const intersected = engine.intersectSpecificationWithDistributionRule(this.specification, rule.user);
          intersectedSpecifications.push(intersected);
        } catch {
          // If intersection fails, use the shared specification as intersected
          intersectedSpecifications.push(this.specification);
        }
      } else {
        // For withEveryone rules, no intersection
        intersectedSpecifications.push(this.specification);
      }
    }

    if (this.rules.length === 0) {
      // No existing rules
      intersectedSpecifications.push(this.specification);
    }

    return new DistributionRules([
      ...this.rules,
      {
        specification: this.specification,
        feeds: buildFeeds(this.specification),
        intersectedSpecifications,
        user: null
      }
    ]);
  }
}

export class DistributionRules {
  static empty: DistributionRules = new DistributionRules([]);

  constructor(
    public rules: DistributionRule[]
  ) { }

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
    const engine = new DistributionEngine(distributionRules);
    const intersectedSpecifications: Specification[] = [];

    for (const rule of distributionRules.rules) {
      if (rule.user !== null) {
        try {
          const intersected = engine.intersectSpecificationWithDistributionRule(specification, rule.user);
          intersectedSpecifications.push(intersected);
        } catch {
          // If intersection fails, use the shared specification as intersected
          intersectedSpecifications.push(specification);
        }
      } else {
        // For withEveryone rules, no intersection
        intersectedSpecifications.push(specification);
      }
    }

    if (distributionRules.rules.length === 0) {
      // No existing rules
      intersectedSpecifications.push(specification);
    }

    return new DistributionRules([
      ...distributionRules.rules,
      {
        specification,
        feeds: buildFeeds(specification),
        intersectedSpecifications,
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