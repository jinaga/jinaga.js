import { Specification, SpecificationParser, User, assertWellFormed, describeSpecification, splitBeforeFirstSuccessor } from "@src";
import { Comment, Post, model as blogModel } from "../blogModel";
import { Item, Link, Owner, Workspace, model as linkModel } from "../linkModel";
import { Administrator, AdministratorRevoked, Company, Employee, Office, President, model } from "../companyModel";

describe('Split specification', () => {
    it('should put all in head if identity specification', () => {
        const specification = model.given(Company).select((company, facts) =>
            company
        );

        const { head, tail } = split(specification.specification);
        expect(tail).toBeUndefined();
        expect(head).toBeDefined();
        expect(describeSpecification(head as Specification, 0)).toEqual(describeSpecification(specification.specification, 0));
    });

    it('should put all in head if only predecessor joins', () => {
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Company)
                .join(company => company, office.company)
        );

        const { head, tail } = split(specification.specification);
        expect(tail).toBeUndefined();
        expect(head).toBeDefined();
        expect(describeSpecification(head as Specification, 0)).toEqual(describeSpecification(specification.specification, 0));
    });

    it('should put all in head if a match joins several predecessors', () => {
        const specification = blogModel.given(Comment).match((comment, facts) =>
            facts.ofType(User)
                .join(user => user, comment.author)
                .join(user => user, comment.post.blog.creator)
        );

        const { head, tail } = split(specification.specification);
        expect(tail).toBeUndefined();
        expect(head).toBeDefined();
        expect(describeSpecification(head as Specification, 0)).toEqual(describeSpecification(specification.specification, 0));
    });

    it('should split after a match that joins several predecessors', () => {
        const specification = blogModel.given(Comment).match((comment, facts) =>
            facts.ofType(User)
                .join(user => user, comment.author)
                .join(user => user, comment.post.blog.creator)
                .selectMany(user => facts.ofType(Post)
                    .join(post => post.author, user))
        );

        const { head, tail } = split(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Comment) {
                u1: Jinaga.User [
                    u1 = p1->author: Jinaga.User
                    u1 = p1->post: Post->blog: Blog->creator: Jinaga.User
                ]
            } => {
                u1 = u1
            }`);
        expect(tail).toBeDefined();
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (u1: Jinaga.User) {
                u2: Post [
                    u2->author: Jinaga.User = u1
                ]
            } => u2`);
    });

    it('should run the whole specification in the tail if only successor joins', () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const { head, tail } = split(specification.specification);
        // The head has no matches. It projects the given, which the tail needs.
        expect(head.matches).toEqual([]);
        expect(tail).toBeDefined();
        expect(describeSpecification(tail as Specification, 0)).toEqual(describeSpecification(specification.specification, 0));
    });

    it('should split if predecessor and then successor', () => {
        const specification = model.given(Employee).match((employee, facts) =>
            facts.ofType(Office)
                .join(office => office, employee.office)
                .selectMany(office => facts.ofType(President)
                    .join(president => president.office, office)));

        const { head, tail } = split(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Employee) {
                u1: Office [
                    u1 = p1->office: Office
                ]
            } => {
                u1 = u1
            }`);
        expect(tail).toBeDefined();
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (u1: Office) {
                u2: President [
                    u2->office: Office = u1
                ]
            } => u2`);
    });

    it('should split if predecessor and then successor, but in one match', () => {
        const specification = model.given(Employee).match((employee, facts) =>
            facts.ofType(President)
                .join(president => president.office, employee.office));

        const { head, tail } = split(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Employee) {
                __s0: Office [
                    __s0 = p1->office: Office
                ]
            } => {
                __s0 = __s0
            }`);
        expect(tail).toBeDefined();
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (__s0: Office) {
                u1: President [
                    u1->office: Office = __s0
                ]
            } => u1`);
    });

    it('should split path when existential condition exists', () => {
        const specification = model.given(Administrator).match((admin, facts) =>
            facts.ofType(Administrator)
                .join(admin2 => admin2.company, admin.company)
                .notExists(admin2 => facts.ofType(AdministratorRevoked)
                    .join(revoked => revoked.administrator, admin2)));

        const { head, tail } = split(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Administrator) {
                __s0: Company [
                    __s0 = p1->company: Company
                ]
            } => {
                __s0 = __s0
            }`);
        expect(tail).toBeDefined();
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (__s0: Company) {
                u1: Administrator [
                    u1->company: Company = __s0
                    !E {
                        u2: Administrator.Revoked [
                            u2->administrator: Administrator = u1
                        ]
                    }
                ]
            } => u1`);
    });

    it('should split when existential appears with only successor joins', () => {
        const specification = model.given(Administrator).match((admin, facts) =>
            facts.ofType(Company)
                .join(company => company, admin.company)
                .selectMany(company => facts.ofType(Administrator)
                    .join(admin2 => admin2.company, company)
                    .notExists(admin2 => facts.ofType(AdministratorRevoked)
                        .join(revoked => revoked.administrator, admin2))));

        const { head, tail } = split(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Administrator) {
                u1: Company [
                    u1 = p1->company: Company
                ]
            } => {
                u1 = u1
            }`);
        expect(tail).toBeDefined();
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (u1: Company) {
                u2: Administrator [
                    u2->company: Company = u1
                    !E {
                        u3: Administrator.Revoked [
                            u3->administrator: Administrator = u2
                        ]
                    }
                ]
            } => u2`);
    });

    it('should carry a projected head label into the tail givens', () => {
        // The rule binds the blog's creator before the first successor join, and
        // projects it. The creator is therefore a given of the tail, alongside
        // the split label the successor join walks from.
        const specification = blogModel.given(Post).match((p, facts) =>
            facts.ofType(User)
                .join(user => user, p.blog.creator)
                .selectMany(creator => facts.ofType(Post)
                    .join(other => other.blog, p.blog)
                    .select(other => creator)));

        const { head, tail } = split(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Post) {
                u1: Jinaga.User [
                    u1 = p1->blog: Blog->creator: Jinaga.User
                ]
                __s0: Blog [
                    __s0 = p1->blog: Blog
                ]
            } => {
                __s0 = __s0
                u1 = u1
            }`);
        expect(tail).toBeDefined();
        expect((tail as Specification).given.map(given => given.label)).toEqual([
            { name: 'u1', type: 'Jinaga.User' },
            { name: '__s0', type: 'Blog' }
        ]);
        expect((tail as Specification).projection).toEqual({ type: 'fact', label: 'u1' });
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (u1: Jinaga.User, __s0: Blog) {
                u2: Post [
                    u2->blog: Blog = __s0
                ]
            } => u1`);
    });

    it('should give each of the pivot\'s predecessor paths its own head label', () => {
        // Formulation A of issue #231: one Owner joined to the workspace of both
        // endpoints of a Link. Each condition walks predecessors of the given and
        // then successors, so each contributes a head match of its own.
        const specification = linkModel.given(Link).match((link, facts) =>
            facts.ofType(Owner)
                .join(o => o.workspace, link.item.workspace)
                .join(o => o.workspace, link.parent.workspace)
                .selectMany(o => facts.ofType(User)
                    .join(u => u, o.user)));

        const { head, tail } = split(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Link) {
                __s0: Workspace [
                    __s0 = p1->item: Item->workspace: Workspace
                ]
                __s1: Workspace [
                    __s1 = p1->parent: Item->workspace: Workspace
                ]
            } => {
                __s0 = __s0
                __s1 = __s1
            }`);
        expect(tail).toBeDefined();
        expect((tail as Specification).given.map(given => given.label)).toEqual([
            { name: '__s0', type: 'Workspace' },
            { name: '__s1', type: 'Workspace' }
        ]);
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (__s0: Workspace, __s1: Workspace) {
                u1: Owner [
                    u1->workspace: Workspace = __s0
                    u1->workspace: Workspace = __s1
                ]
                u2: Jinaga.User [
                    u2 = u1->user: Jinaga.User
                ]
            } => u2`);
    });

    it('should reuse a head label that the pivot already joins to', () => {
        // Formulation C of issue #231: one endpoint's workspace is walked by an
        // earlier match, and the pivot joins to it directly. That condition walks
        // no predecessors, so it needs no split label of its own; only the
        // condition that reaches the other endpoint gets one, and so it is the
        // first split label.
        const specification = linkModel.given(Link).match((link, facts) =>
            facts.ofType(Workspace)
                .join(w => w, link.item.workspace)
                .selectMany(w => facts.ofType(Owner)
                    .join(o => o.workspace, w)
                    .join(o => o.workspace, link.parent.workspace)
                    .selectMany(o => facts.ofType(User)
                        .join(u => u, o.user))));

        const { head, tail } = split(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Link) {
                u1: Workspace [
                    u1 = p1->item: Item->workspace: Workspace
                ]
                __s0: Workspace [
                    __s0 = p1->parent: Item->workspace: Workspace
                ]
            } => {
                __s0 = __s0
                u1 = u1
            }`);
        expect(tail).toBeDefined();
        expect((tail as Specification).given.map(given => given.label)).toEqual([
            { name: 'u1', type: 'Workspace' },
            { name: '__s0', type: 'Workspace' }
        ]);
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (u1: Workspace, __s0: Workspace) {
                u2: Owner [
                    u2->workspace: Workspace = u1
                    u2->workspace: Workspace = __s0
                ]
                u3: Jinaga.User [
                    u3 = u2->user: Jinaga.User
                ]
            } => u3`);
    });

    it('should not hoist a walk from beneath two nested negative existential conditions', () => {
        // Two negations do not cancel. Beneath the inner one, a walk from p1
        // hoisted into the head would be tried one reached fact at a time, and
        // the outer negation would then ask for every archive whether some
        // fact rescues it, where the specification asks whether one fact
        // rescues them all. So the walk stays in the tail, which reads p1.
        const specification = parse(`(p1: Link) {
    u1: Owner [
        u1->workspace: Workspace = p1->item: Item->workspace: Workspace
        !E {
            u2: Archive [
                u2->workspace: Workspace = u1->workspace: Workspace
                !E {
                    u3: Restore [
                        u3->archive: Archive = u2
                        u3->workspace: Workspace = p1->parent: Item->workspace: Workspace
                    ]
                }
            ]
        }
    ]
} => u1`);

        const { tail } = split(specification);
        expect((tail as Specification).given.map(given => given.label)).toEqual([
            { name: 'p1', type: 'Link' },
            { name: '__s0', type: 'Workspace' }
        ]);
    });

});


function parse(text: string): Specification {
    const parser = new SpecificationParser(text);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

function split(specification: Specification) {
    return splitBeforeFirstSuccessor(assertWellFormed(specification, "The specification"));
}

function fixWhitespace(s: string): string {
    return '\n' + s.trimEnd();
}