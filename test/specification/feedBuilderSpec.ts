import { dehydrateReference } from "../../src/fact/hydrate";
import { Feed } from "../../src/specification/feed";
import { FeedBuilder } from "../../src/specification/feed-builder";
import { SpecificationParser } from "../../src/specification/specification-parser";

describe("feed generator", () => {
    it("should produce a single feed for a simple specification", () => {
        const feeds = getFeeds(`
            (root: Root) {
                child: Child [
                    child->root:Root = root
                ]
            }`);

        expect(feeds.length).toEqual(1);
    });
});

const root = dehydrateReference({ type: 'Root' });
const user = dehydrateReference({ type: "Jinaga.User", publicKey: "PUBLIC KEY"});

function getFeeds(input: string): Feed[] {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    const specification = parser.parseSpecification();

    const start = specification.given.map(input => {
        if (input.type === 'Root') {
            return root;
        }
        if (input.type === 'Jinaga.User') {
            return user;
        }
        throw new Error(`Unknown input type ${input.type}`);
    });

    const feedBuilder = new FeedBuilder();
    const feeds = feedBuilder.buildFeeds(start, specification);
    return feeds;
}