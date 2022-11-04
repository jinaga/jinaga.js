import { Role, Specification, Match, PathCondition, ChildProjections, FieldProjection, SingularProjection } from "../../src/specification/specification";
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

    match<U>(definition: (input: Label<T>, facts: FactRepository) => Traversal<U>): SpecificationOf<U> {
        const name = "p1";
        const p1: any = createFactProxy(this.factTypeMap, name, [], this.factType);
        const result = definition(p1, new FactRepository(this.factTypeMap));
        const matches = result.matches;
        const childProjections = result.childProjections;
        const specification: Specification = {
            given: [
                {
                    name,
                    type: this.factType
                }
            ],
            matches,
            childProjections
        };
        return new SpecificationOf<U>(specification);
    }
}

type Label<T> = {
    [ R in keyof T ]: T[R] extends string ? Field<string> : Label<T[R]>;
}

interface Field<T> {
    value: T;
}

class Traversal<T> {
    constructor(
        private input: Label<T>,
        public matches: Match[],
        public childProjections: ChildProjections
    ) { }

    join<U>(left: (unknown: Label<T>) => Label<U>, right: Label<U>): Traversal<T> {
        throw new Error("Not implemented");
    }

    notExists<U>(tupleDefinition: (proxy: Label<T>, facts: FactRepository) => U): Traversal<T> {
        throw new Error("Not implemented");
    }

    select<U>(selector: (label: Label<T>) => SelectorResult<U>): Traversal<U> {
        const definition = selector(this.input);
        if (isLabel<U>(definition)) {
            const payload = getPayload<U>(definition);
            if (payload.type === "field") {
                const childProjection: SingularProjection = {
                    label: payload.root,
                    field: payload.fieldName
                };
                return new Traversal<U>(definition, this.matches, childProjection);
            }
            else {
                throw new Error("Not implemented");
            }
        }
        else {
            throw new Error("Not implemented");
        }
    }
}

type SelectorResult<T> = Field<T> | SelectorResultComposite<T>;

type SelectorResultComposite<T> = {
    [ R in keyof T ]: SelectorResult<T[R]>;
}

class FactRepository {
    constructor(
        private factTypeMap: FactTypeMap
    ) { }

    private unknownIndex = 1;

    ofType<T>(factConstructor: FactConstructor<T>): Source<T> {
        const name = `u${this.unknownIndex++}`;
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

    join<U>(left: (unknown: Label<T>) => Label<U>, right: Label<U>): Traversal<T> {
        const unknown = createFactProxy(this.factTypeMap, this.name, [], this.factType);
        const ancestor = left(unknown);
        const payloadLeft = getPayload(ancestor);
        const payloadRight = getPayload(right);
        if (payloadLeft.type === "field") {
            throw new Error(
                `The property ${payloadLeft.fieldName} is not defined to be a predecessor, and is therefore interpreted as a field. ` +
                `A field cannot be used in a join.`
            );
        }
        if (payloadRight.type === "field") {
            throw new Error(
                `The property ${payloadRight.fieldName} is not defined to be a predecessor, and is therefore interpreted as a field. ` +
                `A field cannot be used in a join.`
            );
        }

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
        return new Traversal<T>(unknown, [match], []);
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

interface LabelPayloadFact {
    type: "fact";
    root: string;
    path: Role[];
    factType: string;
}

interface LabelPayloadField {
    type: "field";
    root: string;
    fieldName: string;
}

type LabelPayload = LabelPayloadFact | LabelPayloadField;

const IDENTITY = Symbol('proxy_target_identity');
function createFactProxy(factTypeMap: FactTypeMap, root: string, path: Role[], factType: string): any {
    const payload: LabelPayloadFact = {
        type: "fact",
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
            if (targetType) {
                const path: Role[] = [...target.path, { name: role, targetType }];
                return createFactProxy(factTypeMap, target.root, path, targetType);
            }
            else {
                if (target.path.length > 0) {
                    throw new Error(
                        `The property ${role} is not defined to be a predecessor, and is therefore interpreted as a field. ` +
                        `You cannot access a field of the predecessor ${target.path[target.path.length-1].name}. ` +
                        `If you want the field of a predecessor, you need to label the predecessor first.`);
                }
                return createFieldProxy(target.root, role);
            }
        }
    });
}

function createFieldProxy(root: string, fieldName: string): any {
    const payload: LabelPayloadField = {
        type: "field",
        root,
        fieldName
    };
    return new Proxy(payload, {
        get: (target, property) => {
            if (property === IDENTITY) {
                return target;
            }
            throw new Error(
                `The property ${property.toString()} is not defined to be a predecessor, and is therefore interpreted as a field. ` +
                `You cannot operate on a field within a specification.`
            );
        }
    });
}

function getPayload<T>(label: Label<T>): LabelPayload {
    const proxy: any = label;
    return proxy[IDENTITY];
}

function isLabel<T>(value: any): value is Label<T> {
    return value[IDENTITY] !== undefined;
}

function lookupRoleType(factTypeMap: FactTypeMap, factType: string, role: string): string | undefined {
    const roleMap = factTypeMap[factType];
    if (!roleMap) {
        throw new Error(`Unknown fact type ${factType}`);
    }
    const roleType = roleMap[role];
    if (!roleType) {
        return undefined;
    }
    return roleType;
}

