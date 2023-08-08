import { User } from "../model/user";
import { describeSpecification } from "../specification/description";
import { Feed } from "../specification/feed";
import { buildFeeds } from "../specification/feed-builder";
import { SpecificationOf } from "../specification/model";
import { Specification } from "../specification/specification";
import { SpecificationParser } from "../specification/specification-parser";

interface DistributionRule {
  specification: Specification;
  feeds: Feed[];
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
    var description = "distribution {\n";
    for (const rule of this.rules) {
      const specificationDescription = describeSpecification(rule.specification, 1).trimStart();
      const userDescription = rule.user ? describeSpecification(rule.user, 1).trimStart() : "everyone\n";
      description += `    share ${specificationDescription}    with ${userDescription}`;
    }
    description += "}\n";
    return description;
  }

  static loadFromDescription(description: string): DistributionRules {
    const parser = new SpecificationParser(description);
    parser.skipWhitespace();
    var distributionRules: DistributionRule[] = [];
    parser.parseDistributionRules({
      share: (specification: Specification, user: Specification | null) => {
        distributionRules.push({
          specification,
          feeds: buildFeeds(specification),
          user
        });
      }
    });
    return new DistributionRules(distributionRules);
  }
}

export function describeDistributionRules(rules: (r: DistributionRules) => DistributionRules): string {
  const distributionRules = rules(new DistributionRules([]));
  return distributionRules.saveToDescription();
}