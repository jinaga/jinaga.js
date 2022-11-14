import { ChildProjections, Condition, ExistentialCondition, FactProjection, FieldProjection, Match, PathCondition, Role, SingularProjection, Specification, SpecificationProjection } from "../../src/specification/specification";
import { describeSpecification } from "./description";

type RoleMap = { [role: string]: string };

class FactOptions<T> {
    constructor(
        public factTypeByRole: RoleMap
    ) { }

    predecessor<U extends keyof T>(role: U, predecessorConstructor: PredecessorConstructor<T[U]>): FactOptions<T> {
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

export type Label<T> = {
    [ R in keyof T ]:
        T[R] extends string ? Field<string> :
        T[R] extends number ? Field<number> :
        T[R] extends Date ? Field<Date> :
        T[R] extends boolean ? Field<boolean> :
        T[R] extends Array<infer U> ? Label<U> :
        T[R] extends infer U | undefined ? Label<U> :
        Label<T[R]>;
}

interface Field<T> {
    value: T;
}

class Traversal<T> {
    constructor(
        private input: T,
        public matches: Match[],
        public childProjections: ChildProjections
    ) { }

    join<U>(left: (input: T) => Label<U>, right: Label<U>): Traversal<T> {
        const leftResult = left(this.input);
        const payloadLeft = getPayload(leftResult);
        const payloadRight = getPayload(right);
        const condition = joinCondition(payloadLeft, payloadRight);
        const matches = this.withCondition(condition);
        return new Traversal<T>(this.input, matches, this.childProjections);
    }

    notExists<U>(tupleDefinition: (proxy: T) => Traversal<U>): Traversal<T> {
        return this.existentialCondition<U>(tupleDefinition, false);
    }

    exists<U>(tupleDefinition: (proxy: T) => Traversal<U>): Traversal<T> {
        return this.existentialCondition<U>(tupleDefinition, true);
    }

    private existentialCondition<U>(tupleDefinition: (proxy: T) => Traversal<U>, exists: boolean) {
        const result = tupleDefinition(this.input);
        const existentialCondition: ExistentialCondition = {
            type: "existential",
            exists,
            matches: result.matches
        };
        const matches: Match[] = this.withCondition<U>(existentialCondition);
        return new Traversal<T>(this.input, matches, this.childProjections);
    }

    private withCondition<U>(condition: Condition) {
        if (this.matches.length === 0) {
            throw new Error("Cannot add a condition without declaring an unknown.");
        }
        const lastMatch = this.matches[this.matches.length - 1];
        const conditions: Condition[] = [
            ...lastMatch.conditions,
            condition
        ];
        const matches: Match[] = [
            ...this.matches.slice(0, this.matches.length - 1),
            {
                ...lastMatch,
                conditions
            }
        ];
        return matches;
    }

    select<U>(selector: (input: T) => U): Traversal<U> {
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
            const childProjections = Object.getOwnPropertyNames(definition).map((key) => {
                const child = (definition as any)[key];
                if (isLabel(child)) {
                    const payload = getPayload(child);
                    if (payload.type === "field") {
                        const projection: FieldProjection = {
                            type: "field",
                            name: key,
                            label: payload.root,
                            field: payload.fieldName
                        };
                        return projection;
                    }
                    else if (payload.type === "fact") {
                        if (payload.path.length > 0) {
                            throw new Error(
                                `You cannot project the fact "${payload.path[payload.path.length - 1].name}" directly. ` +
                                `You must label it first.`);
                        }
                        const projection: FactProjection = {
                            type: "fact",
                            name: key,
                            label: payload.root
                        };
                        return projection;
                    }
                    else {
                        const _exhaustiveCheck: never = payload;
                        throw new Error(`Unexpected payload type: ${(payload as any).type}`);
                    }
                }
                else if (child instanceof Traversal) {
                    const projection: SpecificationProjection = {
                        type: "specification",
                        name: key,
                        matches: child.matches,
                        childProjections: child.childProjections
                    };
                    return projection;
                }
                else {
                    throw new Error(`Unexpected type for property ${key}: ${typeof child}`);
                }
            });
            return new Traversal<U>(definition, this.matches, childProjections);
        }
    }

    selectMany<U>(selector: (input: T) => Traversal<U>): Traversal<U> {
        const traversal = selector(this.input);
        const matches = [
            ...this.matches,
            ...traversal.matches
        ];
        if (!Array.isArray(this.childProjections) || this.childProjections.length > 0) {
            throw new Error("You cannot call selectMany() after a select()");
        }
        const childProjections = traversal.childProjections;
        return new Traversal<U>(traversal.input, matches, childProjections);
    }
}

type SelectorResult<T> = Field<T> | SelectorResultComposite<T>;

type SelectorResultComposite<T> = {
    [ R in keyof T ]: SelectorResult<T[R]>;
}

export class FactRepository {
    constructor(
        private factTypeMap: FactTypeMap
    ) { }

    private unknownIndex = 1;

    ofType<T>(factConstructor: FactConstructor<T>): Source<T> {
        const name = `u${this.unknownIndex++}`;
        return new Source<T>(this.factTypeMap, name, factConstructor.Type);
    }
}

class Source<T> {
    constructor(
        private factTypeMap: FactTypeMap,
        private name: string,
        private factType: string
    ) { }

    join<U>(left: (input: Label<T>) => Label<U>, right: Label<U>): Traversal<Label<T>> {
        const unknown = createFactProxy(this.factTypeMap, this.name, [], this.factType);
        const ancestor = left(unknown);
        const payloadLeft = getPayload(ancestor);
        const payloadRight = getPayload(right);
        if (payloadLeft.root !== this.name) {
            throw new Error("The left side must be based on the source");
        }
        const condition = joinCondition(payloadLeft, payloadRight);
        const match: Match = {
            unknown: {
                name: this.name,
                type: this.factType
            },
            conditions: [
                condition
            ]
        };
        return new Traversal<Label<T>>(unknown, [match], []);
    }
}

type FactConstructor<T> = (new (...args: any[]) => T) & {
    Type: string;
}

type PredecessorConstructor<T> = T extends Array<infer U> ? FactConstructor<U> : FactConstructor<T>;

interface Projection<T> {

}

type CompositeProjection<T> = {
    [P in keyof(T)]: ProjectionResult<T[P]>;
}

type ProjectionResult<T> = Field<T> | Projection<T> | CompositeProjection<T> | Label<T>;

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
function joinCondition(payloadLeft: LabelPayload, payloadRight: LabelPayload) {
    if (payloadLeft.type === "field") {
        throw new Error(
            `The property "${payloadLeft.fieldName}" is not defined to be a predecessor, and is therefore interpreted as a field. ` +
            `A field cannot be used in a join.`
        );
    }
    if (payloadRight.type === "field") {
        throw new Error(
            `The property "${payloadRight.fieldName}" is not defined to be a predecessor, and is therefore interpreted as a field. ` +
            `A field cannot be used in a join.`
        );
    }

    if (payloadLeft.factType !== payloadRight.factType) {
        throw new Error(`Cannot join ${payloadLeft.factType}" with "${payloadRight.factType}"`);
    }
    const condition: PathCondition = {
        type: "path",
        rolesLeft: payloadLeft.path,
        labelRight: payloadRight.root,
        rolesRight: payloadRight.path
    };
    return condition;
}

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
                        `The property "${role}" is not defined to be a predecessor, and is therefore interpreted as a field. ` +
                        `You cannot access a field of the predecessor "${target.path[target.path.length-1].name}". ` +
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
                `The property "${property.toString()}" is not defined to be a predecessor, and is therefore interpreted as a field. ` +
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
        throw new Error(`Unknown fact type "${factType}"`);
    }
    const roleType = roleMap[role];
    if (!roleType) {
        return undefined;
    }
    return roleType;
}

