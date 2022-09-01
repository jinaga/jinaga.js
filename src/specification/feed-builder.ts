import { FactReference } from "../storage";
import { emptyFeed, FactDescription, Feed, InputDescription, withInput } from "./feed";
import { Label, Match, PathCondition, Specification } from "./specification";

type FactByIdentifier = {
    [identifier: string]: FactDescription;
};

type FactReferenceByIdentifier = {
    [identifier: string]: FactReference;
};

export class FeedBuilder {
    buildFeeds(start: FactReference[], specification: Specification): Feed[] {
        // Verify that the number of start facts equals the number of inputs
        if (start.length !== specification.given.length) {
            throw new Error(`The number of start facts (${start.length}) does not equal the number of inputs (${specification.given.length})`);
        }
        // Verify that the input type matches the start fact type
        for (let i = 0; i < start.length; i++) {
            if (start[i].type !== specification.given[i].type) {
                throw new Error(`The type of start fact ${i} (${start[i].type}) does not match the type of input ${i} (${specification.given[i].type})`);
            }
        }

        const givenFacts: FactReferenceByIdentifier = specification.given.reduce((acc, label, i) => ({
            ...acc,
            [label.name]: {
                type: label.type,
                hash: start[i].hash
            }
        }), {} as FactReferenceByIdentifier);

        // The Feed is an immutable data type.
        // The FeedBuilder will branch at various points, and
        // build on the current feed along each branch.
        const initialFeed = emptyFeed;
        const { feeds, knownFacts } = this.addEdges(initialFeed, givenFacts, {}, [], "", specification.matches);

        return feeds;
    }

    addEdges(feed: Feed, givenFacts: FactReferenceByIdentifier, knownFacts: FactByIdentifier, path: number[], prefix: string, matches: Match[]): { feeds: Feed[]; knownFacts: FactByIdentifier; } {
        const feeds: Feed[] = [];
        for (const match of matches) {
            for (const condition of match.conditions) {
                if (condition.type === "path") {
                    ({feed, knownFacts} = this.addPathCondition(feed, givenFacts, knownFacts, path, match.unknown, prefix, condition));
                }
            }
        }
        feeds.push(feed);
        return { feeds, knownFacts };
    }

    addPathCondition(feed: Feed, givenFacts: FactReferenceByIdentifier, knownFacts: FactByIdentifier, path: number[], unknown: Label, prefix: string, condition: PathCondition): { feed: Feed; knownFacts: FactByIdentifier; } {
        const given = givenFacts[condition.labelRight];
        if (given) {
            // If the right-hand side is a given, and not yet a known fact,
            // then add it to the feed.
            if (!knownFacts[condition.labelRight]) {
                feed = withInput(feed, given.type, given.hash);
                knownFacts = {
                    ...knownFacts,
                    [condition.labelRight]: {
                        factIndex: feed.facts.length,
                        factType: given.type
                    }
                };
            }
        }

        return { feed, knownFacts };
    }
}
