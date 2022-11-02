import { Role, Specification, Match, PathCondition } from "../../src/specification/specification";
import { describeSpecification } from "./description";

type RoleMap = { [role: string]: string };

class FactOptions<T> {
    constructor(
        public factTypeByRole: RoleMap
    ) { }

    predecessor<U extends keyof T>(role: U, predecessorConstructor: FactConstructor<T[U]>): FactOptions<T> {
        return new FactOptions<T>({
            ...this.factTypeByRole,
            [role]: predecessorConstructor.Type
        });
    }
}

type FactTypeMap = { [factType: string]: RoleMap };

export class Model {
    constructor(
        private readonly factTypeMap: FactTypeMap = {}
    ) { }

    type<T>(factConstructor: FactConstructor<T>, options?: (f: FactOptions<T>) => FactOptions<T>): Model {
        if (options) {
            const factOptions = options(new FactOptions<T>({}));
            return new Model({
                ...this.factTypeMap,
                [factConstructor.Type]: factOptions.factTypeByRole
            });
        }
        else {
            return new Model({
                ...this.factTypeMap,
                [factConstructor.Type]: {}
            });
        }
    }

    given<T>(factConstructor: FactConstructor<T>) {
        return new Given<T>(factConstructor.Type, this.factTypeMap);
    }
}

export class SpecificationOf<U> {
    constructor(
        private specification: Specification
    ) { }

    toDescriptiveString(depth: number) {
        return describeSpecification(this.specification, depth);
    }
}

class Given<T> {
    constructor(
        private factType: string,
        private factTypeMap: FactTypeMap
    ) { }

    match<U>(definition: (input: Label<T>, facts: FactRepository) => DefinitionResult<U>): SpecificationOf<U> {
        const name = "p1";
        const p1: any = createProxy(this.factTypeMap, name, [], this.factType);
        const result = definition(p1, new FactRepository(this.factTypeMap));
        const specification: Specification = {
            given: [
                {
                    name,
                    type: this.factType
                }
            ],
            matches: [],
            childProjections: []
        };
        return new SpecificationOf<U>(specification);
    }
}

type DefinitionResult<T> = MatchOf<T> | SelectResult<T>;

type Label<T> = {
    [ R in keyof T ]: T[R] extends string ? Field<string> : Label<T[R]>;
}

interface Field<T> {
    value: T;
}

class MatchOf<T> {
    constructor(
        private match: Match
    ) { }

    join<U>(left: (unknown: Label<T>) => Label<U>, right: Label<U>): MatchOf<T> {
        throw new Error("Not implemented");
    }

    notExists<U>(tupleDefinition: (proxy: Label<T>, facts: FactRepository) => U): MatchOf<T> {
        throw new Error("Not implemented");
    }

    select<U>(selector: (label: Label<T>) => SelectorResult<U>): SelectResult<U> {
        throw new Error("Method not implemented.");
    }
}

type SelectorResult<T> = Field<T> | SelectorResultComposite<T>;

type SelectorResultComposite<T> = {
    [ R in keyof T ]: SelectorResult<T[R]>;
}

interface SelectResult<T> {

}

class FactRepository {
    constructor(
        private factTypeMap: FactTypeMap
    ) { }

    private unknownIndex = 1;

    ofType<T>(factConstructor: FactConstructor<T>): Source<T> {
        const name = `unknown${this.unknownIndex++}`;
        return new Source<T>(this.factTypeMap, name, factConstructor.Type);
    }

    observable<T>(definition: () => ProjectionResult<T>): Projection<Observable<T>> {
        throw new Error("Not implemented");
    }
}

class Source<T> {
    constructor(
        private factTypeMap: FactTypeMap,
        private name: string,
        private factType: string
    ) { }

    join<U>(left: (unknown: Label<T>) => Label<U>, right: Label<U>): MatchOf<T> {
        const unknown = createProxy(this.factTypeMap, this.name, [], this.factType);
        const ancestor = left(unknown);
        const payloadLeft = getPayload(ancestor);
        const payloadRight = getPayload(right);
        if (payloadLeft.factType !== payloadRight.factType) {
            throw new Error(`Cannot join ${payloadLeft.factType} with ${payloadRight.factType}`);
        }
        if (payloadLeft.root !== this.name) {
            throw new Error("The left side must be based on the source");
        }
        const condition: PathCondition = {
            type: "path",
            rolesLeft: payloadLeft.path,
            labelRight: payloadRight.root,
            rolesRight: payloadRight.path
        };
        const match: Match = {
            unknown: {
                name: this.name,
                type: this.factType
            },
            conditions: [
                condition
            ]
        };
        return new MatchOf<T>(match);
    }
}

type FactConstructor<T> = (new (...args: any[]) => T) & {
    Type: string;
}

interface Projection<T> {

}

type CompositeProjection<T> = {
    [P in keyof(T)]: ProjectionResult<T[P]>;
}

type ProjectionResult<T> = Field<T> | Projection<T> | CompositeProjection<T> | Label<T>;

interface ProjectionCollection<T> {

}

export class Observable<T> {

}

interface LabelPayload {
    root: string;
    path: Role[];
    factType: string;
}

const IDENTITY = Symbol('proxy_target_identity');
function createProxy(factTypeMap: FactTypeMap, root: string, path: Role[], factType: string): any {
    const payload: LabelPayload = {
        root,
        path,
        factType
    };
    return new Proxy(payload, {
        get: (target, property) => {
            if (property === IDENTITY) {
                return target;
            }
            const role = property.toString();
            const targetType = lookupRoleType(factTypeMap, target.factType, role);
            const path: Role[] = [...target.path, { name: role, targetType }];
            return createProxy(factTypeMap, root, path, targetType);
        }
    });
}

function getPayload<T>(label: Label<T>): LabelPayload {
    const proxy: any = label;
    return proxy[IDENTITY];
}

function lookupRoleType(factTypeMap: FactTypeMap, factType: string, role: string): string {
    const roleMap = factTypeMap[factType];
    if (!roleMap) {
        throw new Error(`Unknown fact type ${factType}`);
    }
    const roleType = roleMap[role];
    if (!roleType) {
        throw new Error(`Unknown role ${role} on fact type ${factType}`);
    }
    return roleType;
}

