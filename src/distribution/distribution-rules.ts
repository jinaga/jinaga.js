import { User } from "../model/user";
import { Feed } from "../specification/feed";
import { buildFeeds } from "../specification/feed-builder";
import { SpecificationOf } from "../specification/model";
import { Specification } from "../specification/specification";

export interface DistributionRule {
  feeds: Feed[];
  user: Specification | null;
}

export class ShareTarget<T, U> {
  constructor(
    private feeds: Feed[],
    private rules: DistributionRule[]
  ) { }

  with(user: SpecificationOf<T, User>): DistributionRules {
    return new DistributionRules([
      ...this.rules,
      {
        feeds: this.feeds,
        user: user.specification
      }
    ]);
  }

  withEveryone(): DistributionRules {
    return new DistributionRules([
      ...this.rules,
      {
        feeds: this.feeds,
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
    return new ShareTarget<T, U>(buildFeeds(specification.specification), this.rules);
  }
}