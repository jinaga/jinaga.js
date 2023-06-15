import { User } from "../model/user";
import { Feed } from "../specification/feed";
import { buildFeeds } from "../specification/feed-builder";
import { SpecificationOf } from "../specification/model";
import { Specification } from "../specification/specification";

export interface DistributionRule {
  feeds: Feed[];
  user: Specification | null;
}

export class DistributionRules {
  constructor(
    public rules: DistributionRule[]
  ) { }

  with(rules: (r: DistributionRules) => DistributionRules): DistributionRules {
    return rules(this);
  }

  everyone<T, U>(specification: SpecificationOf<T, U>): DistributionRules {
    return new DistributionRules([
      ...this.rules,
      {
        feeds: buildFeeds(specification.specification),
        user: null
      }
    ]);
  }

  only<T, U>(specification: SpecificationOf<T, U>, user: SpecificationOf<T, User>): DistributionRules {
    return new DistributionRules([
      ...this.rules,
      {
        feeds: buildFeeds(specification.specification),
        user: user.specification
      }
    ]);
  }
}