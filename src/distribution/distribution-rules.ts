import { User } from "../model/user";
import { describeSpecification } from "../specification/description";
import { buildFeeds } from "../specification/feed-builder";
import { SpecificationOf } from "../specification/model";
import { Specification } from "../specification/specification";
import { skeletonOfSpecification } from "../specification/skeleton";
import { SpecificationParser } from "../specification/specification-parser";
import { validateSpecificationOrThrow } from "../specification/specification-validation";

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
    return DistributionRules.combine(new DistributionRules(this.rules), this.specification, user.specification);
  }

  withEveryone(): DistributionRules {
    return DistributionRules.combine(new DistributionRules(this.rules), this.specification, null);
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
        feeds: buildFeedsOfRule(specification),
        user: validatedUserSpecification(user)
      }
    ]);
  }

  static loadFromDescription(description: string): DistributionRules {
    const parser = new SpecificationParser(description);
    parser.skipWhitespace();
    let distributionRules = DistributionRules.empty;
    while (!parser.atEnd()) {
      if (parser.continues("distribution")) {
        distributionRules = distributionRules.merge(parser.parseDistributionRules());
      }
      else {
        parser.expectEnd();
      }
    }
    return distributionRules;
  }
}

/**
 * Build the feeds of a distribution rule, refusing a specification that cannot
 * produce them.
 *
 * A rule enters a set that lives as long as the process does, and
 * `canAuthorizeByComposition` builds the skeleton of *every* rule's feeds each
 * time it authorizes a query. One rule that cannot be built therefore fails
 * authorization for queries that have nothing to do with it, so the rule is
 * rejected here, where the specification that carries the defect can still be
 * named.
 */
function buildFeedsOfRule(specification: Specification): Specification[] {
  validateSpecificationOrThrow(specification, "The specification of a distribution rule");
  const feeds = buildFeeds(specification);
  for (const feed of feeds) {
    try {
      skeletonOfSpecification(feed);
    }
    catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      throw new Error(`A feed of a distribution rule could not be built. ${message}\n${describeSpecification(specification, 1)}`);
    }
  }
  return feeds;
}

function validatedUserSpecification(user: Specification | null): Specification | null {
  if (user) {
    validateSpecificationOrThrow(user, "The user specification of a distribution rule");
    // `DistributionEngine.canDistributeTo` reads the principal out of this
    // projection, and throws while distributing if it is anything else. A rule
    // that projects a composite could never authorize anyone, so refuse it here
    // instead.
    if (user.projection.type !== "fact") {
      throw new Error(`The user specification of a distribution rule must project a single fact, not a ${user.projection.type}.\n${describeSpecification(user, 1)}`);
    }
  }
  return user;
}

export function describeDistributionRules(rules: (r: DistributionRules) => DistributionRules): string {
  const distributionRules = rules(new DistributionRules([]));
  return distributionRules.saveToDescription();
}