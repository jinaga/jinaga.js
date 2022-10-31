export class SpecificationOf<U> {
    toDescriptiveString(depth: number) {
        throw new Error("Method not implemented.");
    }
}

export function given<T>(factConstructor: FactConstructor<T>): Given<T> {
    return new Given<T>(factConstructor.Type);
}

class Given<T> {
    constructor(
        public factType: string
    ) { }

    match<U>(definition: (input: Label<T>, facts: FactRepository) => DefinitionResult<U>): SpecificationOf<U> {
        throw new Error("Not implemented");
    }
}

type DefinitionResult<T> = Match<T> | SelectResult<T>;

type Label<T> = {
    [ R in keyof T ]: T[R] extends string ? Field<string> : Label<T[R]>;
}

interface Field<T> {
    value: T;
}

export function fact<T>(label: Label<T>): Projection<T> {
    throw new Error("Not implemented");
}

export function field<T, F extends keyof T>(label: Label<T>, name: F): Projection<T[F]> {
    throw new Error("Not implemented");
}

class Match<T> {
    join<U>(left: (unknown: Label<T>) => Label<U>, right: Label<U>): Match<T> {
        throw new Error("Not implemented");
    }

    notExists<U>(tupleDefinition: (proxy: Label<T>, facts: FactRepository) => U): Match<T> {
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
    ofType<T>(factConstructor: FactConstructor<T>): Source<T> {
        throw new Error("Not implemented");
    }

    observable<T>(definition: () => ProjectionResult<T>): Projection<Observable<T>> {
        throw new Error("Not implemented");
    }
}

class Source<T> {
    join<U>(left: (unknown: Label<T>) => Label<U>, right: Label<U>): Match<T> {
        throw new Error("Not implemented");
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
