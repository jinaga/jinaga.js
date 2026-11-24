import { Specification } from "./specification";
import { detectDisconnectedSpecification } from "./UnionFind";
import { feedsOf } from "./feeds";

/**
 * Decompose a specification into the feeds a replica exchanges with its peers.
 *
 * A feed is refused before it is built when it would be the product of two
 * chains that nothing in it joins. No replica can answer such a feed without
 * enumerating that product, so the specification is outside the language
 * (jinaga/jinaga-spec#55). `detectDisconnectedSpecification` is that refusal,
 * and `feedsOf` is the decomposition itself.
 */
export function buildFeeds(specification: Specification): Specification[] {
    detectDisconnectedSpecification(specification);
    return feedsOf(specification);
}
