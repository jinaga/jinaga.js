import { Specification, describeSpecification } from "../../src";
import { dehydrateReference } from "../../src/fact/hydrate";
import { buildFeeds } from "../../src/specification/feed-builder";
import { SpecificationParser } from "../../src/specification/specification-parser";

describe("feed generator", () => {
    it("should produce a single feed for a simple specification", () => {
        const feeds = getFeeds(`
            (root: Root) {
                child: Child [
                    child->root:Root = root
                ]
            }`);

        const expectedFeeds: string[] = [
            `(root: Root) {
                child: Child [
                    child->root: Root = root
                ]
            }`
        ];

        expect(feeds).toEqual(expectedFeeds);
    });

    it("should accept multiple givens", () => {
        const feeds = getFeeds(`
            (user: Jinaga.User, root: Root) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                    assignment->project:MyApp.Project->root:Root = root
                ]
            }
        `);

        const expectedFeeds: string[] = [
            `(user: Jinaga.User, root: Root) {
                assignment: MyApp.Assignment [
                    assignment->user: Jinaga.User = user
                    assignment->project: MyApp.Project->root: Root = root
                ]
            }`
        ];

        expect(feeds).toEqual(expectedFeeds);
    });

    it("should accept existential conditions", () => {
        const feeds = getFeeds(`
            (user: Jinaga.User, root: Root) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                    assignment->project:MyApp.Project->root: Root = root
                    !E {
                        revoked: MyApp.Assignment.Revoked [
                            revoked->assignment:MyApp.Assignment = assignment
                        ]
                    }
                ]
            }`);

        const expectedFeeds: string[] = [
            `(user: Jinaga.User, root: Root) {
                assignment: MyApp.Assignment [
                    assignment->user: Jinaga.User = user
                    assignment->project: MyApp.Project->root: Root = root
                ]
                revoked: MyApp.Assignment.Revoked [
                    revoked->assignment: MyApp.Assignment = assignment
                ]
            }`,
            `(user: Jinaga.User, root: Root) {
                assignment: MyApp.Assignment [
                    assignment->user: Jinaga.User = user
                    assignment->project: MyApp.Project->root: Root = root
                    !E {
                        revoked: MyApp.Assignment.Revoked [
                            revoked->assignment: MyApp.Assignment = assignment
                        ]
                    }
                ]
            }`
        ];

        expect(feeds).toEqual(expectedFeeds);
    });

    it("should parse deeply nested projection", () => {
        const feeds = getFeeds(`
            (root: Root) {
                parent: Parent [
                    parent->root: Root = root
                ]
            } => {
                children = {
                    child: Child [
                        child->parent: Parent = parent
                    ]
                } => {
                    grandchildren = {
                        grandchild: Grandchild [
                            grandchild->child: Child = child
                        ]
                    }
                }
            }`);

        const expectedFeeds: string[] = [
            `(root: Root) {
                parent: Parent [
                    parent->root: Root = root
                ]
            }`,
            `(root: Root) {
                parent: Parent [
                    parent->root: Root = root
                ]
                child: Child [
                    child->parent: Parent = parent
                ]
            }`,
            `(root: Root) {
                parent: Parent [
                    parent->root: Root = root
                ]
                child: Child [
                    child->parent: Parent = parent
                ]
                grandchild: Grandchild [
                    grandchild->child: Child = child
                ]
            }`
        ];

        expect(feeds).toEqual(expectedFeeds);
    });

    it("should accept a projection", () => {
        const feeds = getFeeds(`
            (root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                ]
            } => {
                names = {
                    name: MyApplication.Project.Name [
                        name->project: MyApplication.Project = project
                    ]
                }
            }`);

        const expectedFeeds: string[] = [
            `(root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                ]
            }`,
            `(root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                ]
                name: MyApplication.Project.Name [
                    name->project: MyApplication.Project = project
                ]
            }`
        ];

        expect(feeds).toEqual(expectedFeeds);
    });
});

function getSpecification(input: string) {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    const specification = parser.parseSpecification();
    return specification;
}

function getFeeds(input: string): string[] {
    const specification = getSpecification(input);

    const feeds = buildFeeds(specification);
    const descriptions = feeds.map(feed => describeSpecification(feed, 3).trim());
    return descriptions;
}