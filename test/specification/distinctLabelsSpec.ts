import { Match, Projection, Specification, SpecificationParser, buildFeeds, skeletonOfSpecification, wellFormedErrors } from "@src";
import { withDistinctLabels } from "../../src/specification/distinct-labels";

function parse(text: string): Specification {
    const parser = new SpecificationParser(text);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

const withoutRepeats: Record<string, string> = {
    "several givens": `(u: User, p: Project) {
        a: Assignment [ a->user: User = u a->project: Project = p !E { v: Revoke [ v->assignment: Assignment = a ] } ]
    } => a`,
    "nested negation": `(t: Tenant) {
        e: Event [ e->tenant: Tenant = t !E { d: Delete [ d->event: Event = e !E { x: Restore [ x->delete: Delete = d ] } ] } ]
        n: Name [ n->event: Event = e ]
    } => n`,
    "a positive condition inside a negative one": `(t: Tenant) {
        e: Event [ e->tenant: Tenant = t !E { d: Delete [ d->event: Event = e E { a: Approval [ a->delete: Delete = d ] } ] } ]
    } => e`,
    "sibling children sharing a label": `(r: Restaurant) {
        s: Server [ s->restaurant: Restaurant = r ]
    } => {
        names = { n: Name [ n->server: Server = s !E { next: Name [ next->prior: Name = n ] } ] } => n.value
        rates = { sr: Rate [ sr->server: Server = s !E { next: Rate [ next->prior: Rate = sr ] } ] } => sr
    }`
};

describe("withDistinctLabels", () => {
    it.each(Object.entries(withoutRepeats))("returns a specification without repeats unchanged: %s", (_, text) => {
        const specification = parse(text);
        expect(withDistinctLabels(specification)).toEqual(specification);
    });

    it("renames the later declaration to the first unused name2, name3, ... and its references with it", () => {
        const specification = parse(`(r: Restaurant) {
            s: Server [ s->restaurant: Restaurant = r
                !E { sr: Rehired [ sr->server: Server = s ] }
                !E { sr: Fired [ sr->server: Server = s ] }
            ]
        } => {
            names = { sr3: Name [ sr3->server: Server = s ] } => sr3.value
            rates = { sr: Rate [ sr->server: Server = s !E { next: Rate [ next->prior: Rate = sr ] } ] } => {
                value = sr.amount
                rate = sr
            }
        }`);
        // The second negative condition takes `sr2`. The child `names` repeats
        // nothing. `sr3` is declared in the specification, so the child `rates`
        // skips it and takes `sr4`.
        expect(withDistinctLabels(specification)).toEqual(parse(`(r: Restaurant) {
            s: Server [ s->restaurant: Restaurant = r
                !E { sr: Rehired [ sr->server: Server = s ] }
                !E { sr2: Fired [ sr2->server: Server = s ] }
            ]
        } => {
            names = { sr3: Name [ sr3->server: Server = s ] } => sr3.value
            rates = { sr4: Rate [ sr4->server: Server = s !E { next: Rate [ next->prior: Rate = sr4 ] } ] } => {
                value = sr4.amount
                rate = sr4
            }
        }`));
    });
});

// ---- A scope-aware renaming of unknowns, givens kept ----

type Random = () => number;

function mulberry32(seed: number): Random {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Fresh names drawn at random, so the renaming also changes the names' order.
function alpha(specification: Specification, random: Random): Specification {
    const used = new Set<string>();
    const fresh = () => {
        let name: string;
        do { name = "v" + Math.floor(random() * 1e6).toString(36); } while (used.has(name));
        used.add(name);
        return name;
    };
    const resolve = (scope: Map<string, string>, label: string) => {
        const name = scope.get(label);
        if (name === undefined) throw new Error(`Unbound label ${label}`);
        return name;
    };
    function renameMatches(matches: Match[], scope: Map<string, string>): { matches: Match[]; scope: Map<string, string> } {
        const renamed = matches.map(match => {
            const inner = new Map(scope).set(match.unknown.name, fresh());
            const conditions = match.conditions.map(condition => condition.type === "path"
                ? { ...condition, labelRight: resolve(scope, condition.labelRight) }
                : { ...condition, matches: renameMatches(condition.matches, inner).matches });
            scope = inner;
            return { unknown: { ...match.unknown, name: resolve(inner, match.unknown.name) }, conditions };
        });
        return { matches: renamed, scope };
    }
    function renameProjection(projection: Projection, scope: Map<string, string>): Projection {
        if (projection.type !== "composite") return { ...projection, label: resolve(scope, projection.label) };
        return {
            ...projection,
            components: projection.components.map(component => {
                if (component.type !== "specification") return { ...component, label: resolve(scope, component.label) };
                const child = renameMatches(component.matches, scope);
                return { ...component, matches: child.matches, projection: renameProjection(component.projection, child.scope) };
            })
        };
    }
    const top = renameMatches(specification.matches, new Map(specification.given.map(g => [g.label.name, g.label.name])));
    return { ...specification, matches: top.matches, projection: renameProjection(specification.projection, top.scope) };
}

// ---- Random specifications whose names repeat across scopes ----

// Each type has one predecessor role: [type, role, predecessor type].
const schema: [string, string, string][] = [
    ["A", "root", "Root"], ["B", "a", "A"], ["C", "b", "B"], ["D", "a", "A"],
    ["E", "d", "D"], ["F", "c", "C"], ["G", "a", "A"], ["H", "g", "G"]
];
// A small pool of names, so that separate scopes often reuse one.
const pool = ["x", "y", "w", "q"];

function pick<T>(random: Random, items: T[]): T {
    return items[Math.floor(random() * items.length)];
}

// Matches joined to `scope`. Positive conditions are generated only outside
// negative ones, which keeps clear of #425.
function genMatches(random: Random, scope: [string, string][], depth: number, count: number, negated: boolean): { text: string; scope: [string, string][] } {
    let text = "";
    for (let i = 0; i < count; i++) {
        // The first match of a condition joins its anchor, scope[0].
        const options = schema.filter(([, , predecessor]) => i === 0 && depth > 0
            ? predecessor === scope[0][1]
            : scope.some(([, type]) => type === predecessor));
        if (options.length === 0) break;
        const [type, role, predecessor] = pick(random, options);
        const target = i === 0 && depth > 0 ? scope[0][0] : pick(random, scope.filter(([, t]) => t === predecessor))[0];
        const free = pool.filter(n => !scope.some(([s]) => s === n));
        if (free.length === 0) break;
        const name = pick(random, free);
        let body = `${name}->${role}: ${predecessor} = ${target}\n`;
        const inner: [string, string][] = [[name, type], ...scope];
        if (depth < 3) {
            for (let k = Math.floor(random() * 3); k > 0; k--) {
                if (!schema.some(([, , p]) => p === type)) break;
                const exists = !negated && random() < 0.4;
                const condition = genMatches(random, inner, depth + 1, 1 + Math.floor(random() * 2), negated || !exists);
                if (condition.text) body += `${exists ? "E" : "!E"} {\n${condition.text}}\n`;
            }
        }
        text += `${name}: ${type} [\n${body}]\n`;
        scope = inner;
    }
    return { text, scope };
}

function genSpecification(random: Random): string {
    const top = genMatches(random, [["g", "Root"]], 0, 1 + Math.floor(random() * 3), false);
    const last = top.scope[0][0];
    if (random() < 0.6) {
        const child = genMatches(random, top.scope, 1, 1 + Math.floor(random() * 2), false);
        return `(g: Root) {\n${top.text}} => {\n top = ${last}\n kids = {\n${child.text}} => ${child.scope[0][0]}\n}`;
    }
    return `(g: Root) {\n${top.text}} => ${last}`;
}

describe("feed skeletons under a scope-aware renaming of unknowns", () => {
    const skeletons = (specification: Specification) => buildFeeds(specification).map(skeletonOfSpecification);

    it("do not change, for random specifications with and without repeated labels", () => {
        let repeating = 0;
        let distinct = 0;
        for (let i = 0; i < 400; i++) {
            const text = genSpecification(mulberry32(1000 + i));
            const specification = parse(text);
            const feeds = buildFeeds(specification);
            feeds.forEach(feed => expect(wellFormedErrors(feed)).toEqual([]));
            const expected = skeletons(specification);
            for (let seed = 0; seed < 5; seed++) {
                expect(skeletons(alpha(specification, mulberry32(i * 31 + seed)))).toEqual(expected);
            }
            if (withDistinctLabels(specification) !== specification) repeating++; else distinct++;
        }
        // Both kinds must be well represented for the property to mean anything.
        expect(repeating).toBeGreaterThan(50);
        expect(distinct).toBeGreaterThan(50);
    });
});
