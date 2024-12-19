import { User } from "../model/user";
import { describeSpecification } from "../specification/description";
import { buildFeeds } from "../specification/feed-builder";
import { SpecificationOf } from "../specification/model";
import { Specification } from "../specification/specification";
import { SpecificationParser } from "../specification/specification-parser";

interface DistributionRule {
  specification: Specification;
  feeds: Specification[];
  user: Specification | null;
}

class ShareTarget<T, U> {
  constructor(
    private specification: Specification,
    private rules: DistributionRule[]
  ) { }

  with(user: SpecificationOf<T, User>): DistributionRules {
    return new DistributionRules([
      ...this.rules,
      {
        specification: this.specification,
        feeds: buildFeeds(this.specification),
        user: user.specification
      }
    ]);
  }

  withEveryone(): DistributionRules {
    return new DistributionRules([
      ...this.rules,
      {
        specification: this.specification,
        feeds: buildFeeds(this.specification),
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
    return new DistributionRules([
      ...distributionRules.rules,
      {
        specification,
        feeds: buildFeeds(specification),
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