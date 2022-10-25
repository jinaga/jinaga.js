export class Specification<U> {
}

export function given<T>(factConstructor: Type<T>): Given<T> {
    throw new Error("Not implemented");
}

class Given<T> {
    match<U>(definition: (input: Label<T>, facts: FactRepository) => ProjectionResult<U>): Specification<U> {
        throw new Error("Not implemented");
    }
}

class Label<T> {
    predecessor<R extends keyof T, U extends T[R]>(role: R, type: Type<U>): Label<U> {
        throw new Error("Not implemented");
    }

    fact(): Projection<T> {
        throw new Error("Not implemented");
    }

    field<F extends keyof T>(name: F): Projection<T[F]> {
        throw new Error("Not implemented");
    }
}

class Match<T> extends Label<T> {
    join<U>(left: (unknown: Label<T>) => Label<U>, right: Label<U>): Match<T> {
        throw new Error("Not implemented");
    }

    notExists<U>(tupleDefinition: (proxy: Label<T>, facts: FactRepository) => U): Match<T> {
        throw new Error("Not implemented");
    }
}

class FactRepository {
    ofType<T>(factConstructor: Type<T>): Source<T> {
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

interface Type<T> extends Function {
    new (...args: any[]): T;
}

interface Projection<T> {

}

type CompositeProjection<T> = {
    [P in keyof(T)]: Projection<T[P]>;
}

type ProjectionResult<T> = Projection<T> | CompositeProjection<T>;

export class Observable<T> {

}
