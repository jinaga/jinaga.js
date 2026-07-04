import { alphaTransform, Invalid, Specification, SpecificationParser } from "@src";

function parseSpecification(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

describe("Alpha transformation", () => {
    it("transforms specification labels with a mapping", () => {
        const specification = parseSpecification(`(user: Jinaga.User) {
            assignment: MyApp.Assignment [
                assignment->user:Jinaga.User = user
            ]
        }`);

        const mapping = { user: "u", assignment: "a" };

        const result = alphaTransform(specification, mapping);

        const expected = parseSpecification(`(u: Jinaga.User) {
            a: MyApp.Assignment [
                a->user:Jinaga.User = u
            ]
        }`);

        expect(result).toEqual(expected);
    });

    it("throws Invalid error for null specification", () => {
        const mapping = { user: "u" };

        expect(() => alphaTransform(null as any, mapping)).toThrow(Invalid);
    });

    it("throws Invalid error when mapping would create duplicate label names", () => {
        const specification = parseSpecification(`(user: Jinaga.User) {
            assignment: MyApp.Assignment [
                assignment->user:Jinaga.User = user
            ]
        }`);

        const mapping = { user: "u", assignment: "u" };

        expect(() => alphaTransform(specification, mapping)).toThrow(Invalid);
    });

    it("transforms specifications with nested existential conditions", () => {
        const specification = parseSpecification(`(user: Jinaga.User) {
        post: MyApp.Post [
            post->user:Jinaga.User = user
            E {
                comment: MyApp.Comment [
                    comment->post:MyApp.Post = post
                    E {
                        reply: MyApp.Reply [
                            reply->comment:MyApp.Comment = comment
                        ]
                    }
                ]
            }
        ] }`);

        const mapping = { user: "u", post: "p", comment: "c", reply: "r" };

        const result = alphaTransform(specification, mapping);

        const expected = parseSpecification(`(u: Jinaga.User) {
        p: MyApp.Post [
            p->user:Jinaga.User = u
            E {
                c: MyApp.Comment [
                    c->post:MyApp.Post = p
                    E {
                        r: MyApp.Reply [
                            r->comment:MyApp.Comment = c
                        ]
                    }
                ]
            }
        ] }`);

        expect(result).toEqual(expected);
    });

    it("transforms field projections", () => {
        const specification = parseSpecification(`(user: Jinaga.User) {
            name: MyApp.User.Name [
                name->user:Jinaga.User = user
            ]
        } => name.value`);

        const mapping = { user: "u", name: "n" };

        const result = alphaTransform(specification, mapping);

        const expected = parseSpecification(`(u: Jinaga.User) {
            n: MyApp.User.Name [
                n->user:Jinaga.User = u
            ]
        } => n.value`);

        expect(result).toEqual(expected);
    });

    it("integrates parsing and alpha transformation", () => {
        const input = `(user: Jinaga.User) {
            assignment: MyApp.Assignment [
                assignment->user:Jinaga.User = user
            ]
        }`;
        const specification = parseSpecification(input);

        const mapping = { user: "u", assignment: "a" };
        const transformed = alphaTransform(specification, mapping);

        const expected = parseSpecification(`(u: Jinaga.User) {
            a: MyApp.Assignment [
                a->user:Jinaga.User = u
            ]
        }`);

        expect(transformed).toEqual(expected);
    });
});
