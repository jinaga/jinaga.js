import { hashSymbol } from "../fact/hydrate";
import { describeSpecification } from "./description";
import { CompositeProjection, Condition, ExistentialCondition, FactProjection, FieldProjection, HashProjection, Match, NamedComponentProjection, PathCondition, Projection, Role, Specification } from "./specification";

type RoleMap = { [role: string]: string };

type PredecessorOf<T, R extends keyof T> =
    R extends any ?
        T[R] extends string ? never :
        T[R] extends number ? never :
        T[R] extends Date ? never :
        T[R] extends Date | string ? never :
        T[R] extends boolean ? never :
        R :
    never;

class FactOptions<T> {
    constructor(
        public factTypeByRole: RoleMap
    ) { }

    predecessor<U extends PredecessorOf<T, keyof T>>(role: U, predecessorConstructor: PredecessorConstructor<T[U]>): FactOptions<T> {
        return new FactOptions<T>({
            ...this.factTypeByRole,
            [role]: predecessorConstructor.Type
        });
    }
}

type FactTypeMap = { [factType: string]: RoleMap };

type ExtractFactConstructors<T> = T extends [ FactConstructor<infer First>, ...infer Rest ] ? [ First, ...ExtractFactConstructors<Rest> ] : [];

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

    given<T extends FactConstructor<unknown>[]>(...factConstructors: T) {
        return new Given<ExtractFactConstructors<T>>(factConstructors.map(c => c.Type), this.factTypeMap);
    }
}

export class SpecificationOf<T, U> {
    constructor(
        public specification: Specification
    ) { }

    toDescriptiveString(depth: number) {
        return describeSpecification(this.specification, depth);
    }
}

type MatchParameters<T> = T extends [ infer First, ...infer Rest ] ? [ Label<First>, ...MatchParameters<Rest> ] : [ FactRepository ];
type SpecificationResult<U> =
    U extends string ? U :
    U extends number ? U :
    U extends boolean ? U :
    U extends Date ? U :
    U extends Label<infer V> ? V :
    U extends Traversal<infer V> ? Array<SpecificationResult<V>> :
    U extends object ? { [K in keyof U]: SpecificationResult<U[K]> } :
    U;

class Given<T extends any[]> {
    constructor(
        private factTypes: string[],
        private factTypeMap: FactTypeMap
    ) { }

    match<U>(definition: (...parameters: MatchParameters<T>) => Traversal<U>): SpecificationOf<T, SpecificationResult<U>> {
        const labels = this.factTypes.map((factType, i) => {
            const name = `p${i + 1}`;
            return createFactProxy(this.factTypeMap, name, [], factType);
        });
        const result = (definition as any)(...labels, new FactRepository(this.factTypeMap));
        const matches = result.matches;
        const projection = result.projection;
        const given = this.factTypes.map((type, i) => {
            const name = `p${i + 1}`;
            return { name, type };
        });
        const specification: Specification = {
            given,
            matches,
            projection
        };
        return new SpecificationOf<T, SpecificationResult<U>>(specification);
    }
}

export type Label<T> = {
    [ R in keyof T ]:
        T[R] extends string ? T[R] :
        T[R] extends number ? T[R] :
        T[R] extends Date ? T[R] :
        T[R] extends boolean ? T[R] :
        T[R] extends Array<infer U> ? Label<U> :
        T[R] extends infer U | undefined ? Label<U> :
        Label<T[R]>;
}

class Traversal<T> {
    constructor(
        private input: T,
        public matches: Match[],
        public projection: Projection
    ) { }

    join<U>(left: (input: T) => Label<U>, right: Label<U>): Traversal<T> {
        const leftResult = left(this.input);
        const payloadLeft = getPayload(leftResult);
        const payloadRight = getPayload(right);
        const condition = joinCondition(payloadLeft, payloadRight);
        const matches = this.withCondition(condition);
        return new Traversal<T>(this.input, matches, this.projection);
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
        return new Traversal<T>(this.input, matches, this.projection);
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
                const fieldProjection: FieldProjection = {
                    type: "field",
                    label: payload.root,
                    field: payload.fieldName
                };
                return new Traversal<U>(definition, this.matches, fieldProjection);
            }
            else if (payload.type === "fact") {
                if (payload.path.length > 0) {
                    throw new Error(`Cannot select ${payload.root}.${payload.path.join(".")} directly. Give the fact a label first.`);
                }
                const factProjection: FactProjection = {
                    type: "fact",
                    label: payload.root,
                };
                return new Traversal<U>(definition, this.matches, factProjection);
            }
            else if (payload.type === "hash") {
                const hashProjection: HashProjection = {
                    type: "hash",
                    label: payload.root
                };
                return new Traversal<U>(definition, this.matches, hashProjection);
            }
            else {
                const _exhaustiveCheck: never = payload;
                throw new Error(`Unexpected payload type: ${(payload as any).type}`);
            }
        }
        else {
            const components = Object.getOwnPropertyNames(definition).map((key) => {
                const child = (definition as any)[key];
                if (isLabel(child)) {
                    const payload = getPayload(child);
                    if (payload.type === "field") {
                        const projection: NamedComponentProjection = {
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
                        const projection: NamedComponentProjection = {
                            type: "fact",
                            name: key,
                            label: payload.root
                        };
                        return projection;
                    }
                    else if (payload.type === "hash") {
                        throw new Error("Method not implemented.");
                    }
                    else {
                        const _exhaustiveCheck: never = payload;
                        throw new Error(`Unexpected payload type: ${(payload as any).type}`);
                    }
                }
                else if (child instanceof Traversal) {
                    const projection: NamedComponentProjection = {
                        type: "specification",
                        name: key,
                        matches: child.matches,
                        projection: child.projection
                    };
                    return projection;
                }
                else {
                    throw new Error(`Unexpected type for property ${key}: ${typeof child}`);
                }
            });
            const compositeProjection: CompositeProjection = {
                type: "composite",
                components
            }
            return new Traversal<U>(definition, this.matches, compositeProjection);
        }
    }

    selectMany<U>(selector: (input: T) => Traversal<U>): Traversal<U> {
        const traversal = selector(this.input);
        const matches = [
            ...this.matches,
            ...traversal.matches
        ];
        const projection = traversal.projection;
        return new Traversal<U>(traversal.input, matches, projection);
    }
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
        const projection: FactProjection = {
            type: "fact",
            label: this.name
        };
        return new Traversal<Label<T>>(unknown, [match], projection);
    }
}

export type FactConstructor<T> = (new (...args: any[]) => T) & {
    Type: string;
}

type PredecessorConstructor<T> = T extends Array<infer U> ? FactConstructor<U> : FactConstructor<T>;

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

interface LabelPayloadHash {
    type: "hash";
    root: string;
}

type LabelPayload = LabelPayloadFact | LabelPayloadField | LabelPayloadHash;

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
    if (payloadLeft.type === "hash") {
        throw new Error("You cannot join on a hash.");
    }
    if (payloadRight.type === "hash") {
        throw new Error("You cannot join on a hash.");
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
            if (property === hashSymbol) {
                if (target.path.length > 0) {
                    throw new Error(
                        `You cannot hash the fact "${target.path[target.path.length - 1].name}" directly. ` +
                        `You must label it first.`);
                }
                return createHashProxy(target.root);
            }
            const role = property.toString();
            const predecessorType = lookupRoleType(factTypeMap, target.factType, role);
            if (predecessorType) {
                const path: Role[] = [...target.path, { name: role, predecessorType }];
                return createFactProxy(factTypeMap, target.root, path, predecessorType);
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

function createHashProxy(root: string): any {
    const payload: LabelPayloadHash = {
        type: "hash",
        root
    };
    return new Proxy(payload, {
        get: (target, property) => {
            if (property === IDENTITY) {
                return target;
            }
            throw new Error(
                `The property "${property.toString()}" is not defined on a hash.`
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

