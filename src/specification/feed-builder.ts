import { FactReference } from "../storage";
import { emptyFeed, FactDescription, Feed, withEdge, withFact, withInput, withOutput } from "./feed";
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

        // Determine whether we have already written the output.
        const knownFact = knownFacts[unknown.name];
        const roleCount = condition.rolesLeft.length + condition.rolesRight.length;

        // Walk up the right-hand side.
        // This generates predecessor joins from a given or prior label.
        let fact = knownFacts[condition.labelRight];
        if (!fact) {
            throw new Error(`Label ${condition.labelRight} not found. Known labels: ${Object.keys(knownFacts).join(", ")}`);
        }
        let factType = fact.factType;
        let factIndex = fact.factIndex;
        for (const [i, role] of condition.rolesRight.entries()) {
            if (i === roleCount - 1 && knownFact) {
                // If we have already written the output, we can use the fact index.
                feed = withEdge(feed, knownFact.factIndex, factIndex, role.name, path);
                factIndex = knownFact.factIndex;
            }
            else {
                // If we have not written the fact, we need to write it now.
                const { feed: feedWithFact, factIndex: predecessorFactIndex } = withFact(feed, role.targetType);
                feed = withEdge(feedWithFact, predecessorFactIndex, factIndex, role.name, path);
                factIndex = predecessorFactIndex;
            }
            factType = role.targetType;
        }

        const rightType = factType;

        // Walk up the left-hand side.
        // We will need to reverse this walk to generate successor joins.
        factType = unknown.type;
        const newEdges: {
            roleName: string;
            declaringType: string;
        }[] = [];
        for (const role of condition.rolesLeft) {
            newEdges.push({
                roleName: role.name,
                declaringType: factType
            });
            factType = role.targetType;
        }

        if (factType !== rightType) {
            throw new Error(`Type mismatch: ${factType} is compared to ${rightType}`);
        }

        newEdges.reverse().forEach(({ roleName, declaringType }, i) => {
            if (condition.rolesRight.length + i === roleCount - 1 && knownFact) {
                feed = withEdge(feed, factIndex, knownFact.factIndex, roleName, path);
                factIndex = knownFact.factIndex;
            }
            else {
                const { feed: feedWithFact, factIndex: successorFactIndex } = withFact(feed, declaringType);
                feed = withEdge(feedWithFact, factIndex, successorFactIndex, roleName, path);
                factIndex = successorFactIndex;
            }
        });

        // If we have not captured the known fact, add it now.
        if (!knownFact) {
            knownFacts = { ...knownFacts, [unknown.name]: { factIndex, factType: unknown.type } };
            // If we have not written the output, write it now.
            // Only write the output if we are not inside of an existential condition.
            if (path.length === 0) {
                feed = withOutput(feed, factIndex);
            }
        }

        return { feed, knownFacts };
    }
}
