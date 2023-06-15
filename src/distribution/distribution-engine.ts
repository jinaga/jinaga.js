import { Feed } from "../specification/feed";
import { FactReference, Storage } from "../storage";
import { DistributionRules } from "./distribution-rules";

export class DistributionEngine {
  constructor(
    private distributionRules: DistributionRules,
    private store: Storage
  ) { }

  async canDistribute(feed: Feed, start: FactReference[], user: FactReference | null): Promise<boolean> {
    return false;
  }
}