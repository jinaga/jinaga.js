import { FactReference } from "../storage";
import { FactDescription, Feed, InputDescription, newFeed } from "./feed";
import { Match, Specification } from "./specification";

type FactByIdentifier = {
    [identifier: string]: FactDescription;
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

        // Allocate a fact table for each given.
        // While the fact type and hash parameters are zero, the join will not be written.
        const inputs: InputDescription[] = specification.given
            .map((label, i) => ({
                label: label.name,
                factIndex: i+1,
                factType: label.type,
                factHash: start[i].hash,
                factTypeParameter: 0,
                factHashParameter: 0
            }));
        const facts: FactDescription[] = specification.given
            .map((label, i) => ({
                factIndex: i+1,
                type: label.type
            }));
        const givenFacts = specification.given.reduce((knownFacts, label, i) => ({
                ...knownFacts,
                [label.name]: facts[i]
            }), {} as FactByIdentifier);
    
        // The Feed is an immutable data type.
        // Initialize it with the inputs and facts.
        // The FeedBuilder will branch at various points, and
        // build on the current feed along each branch.
        const initialFeed = newFeed(inputs, facts);
        const { feeds, knownFacts } = this.addEdges(initialFeed, givenFacts, [], "", specification.matches);

        return feeds;
    }

    addEdges(feed: Feed, knownFacts: FactByIdentifier, path: number[], prefix: string, matches: Match[]): { feeds: Feed[]; knownFacts: FactByIdentifier; } {
        const feeds: Feed[] = [];
        feeds.push(feed);
        return { feeds, knownFacts };
    }
}
