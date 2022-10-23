import { Template } from '../template';
import { Direction, ExistentialCondition, Join, PropertyCondition, Quantifier, Step } from './steps';

interface Proxy {
    has(name: string, type: string): Proxy;
}

export class SpecificationOf<T> {
    public existential = false;
    public specification = true;

    constructor (
        public template: Template<T>,
        public conditions: Step[]
    ) {}

    suchThat<U>(condition: (target: T) => ConditionOf<U>): SpecificationOf<T> {
        return new SpecificationOf<T>(this.template, this.conditions.concat(parseTemplate(condition)));
    }
}

export class ConditionOf<T> {
    public existential = true;

    constructor (
        public template: Template<T>,
        public conditions: Step[],
        public negative: boolean
    ) {}

    suchThat<U>(condition: ((target: T) => ConditionOf<U>)): ConditionOf<T> {
        return new ConditionOf<T>(this.template, this.conditions.concat(parseTemplate(condition)), this.negative);
    }
}

export class Preposition<T, U> {
    constructor (
        public steps: Step[]
    ) {}

    /**
     * Extend a preposition chain.
     * 
     * @param specification A template function, which returns j.match
     * @returns A preposition that can be passed to query or watch, or used to construct a preposition chain
     */
    then<V>(specification: (target : U) => SpecificationOf<V>): Preposition<T, V> {
        return new Preposition<T, V>(this.steps.concat(parseTemplate(specification)));
    }

    static for<T, U>(specification: (target : T) => SpecificationOf<U>): Preposition<T, U> {
        return new Preposition<T, U>(parseTemplate(specification));
    }
}

class ParserProxy implements Proxy {
    constructor(
        private __parent: ParserProxy | null,
        private __role: string | null) {
    }

    [key:string]: any;

    has(name:string, type: string):Proxy {
        if (type === undefined) {
            throw new Error("The `has` function now takes two parameters. Please pass the predecessor type as the second.");
        }
        const proxy = new ParserProxy(this, name);
        this[name] = proxy;
        proxy.type = type;
        return proxy;
    }

    public createQuery(): Array<Step> {
        const currentSteps: Array<Step> = [];
        for (const name in this) {
            const value: any = this[name];
            if (name[0] != "_" && typeof this[name] !== "function" && !(value instanceof ParserProxy)) {
                currentSteps.push(new PropertyCondition(name, value));
            }
        }
        if (this.__parent && this.__role) {
            const steps = this.__parent.createQuery();
            const step: Step = new Join(Direction.Predecessor, this.__role);
            steps.push(step);
            return steps.concat(currentSteps);
        }
        else {
            return currentSteps;
        }
    }
}

function findTarget(spec:any): Array<Step> | null {
    if (spec instanceof ParserProxy) {
        return spec.createQuery();
    }
    if (Array.isArray(spec) && spec.length === 1) {
        return findTarget(spec[0]);
    }
    if (spec instanceof Object) {
        const steps: Array<Step> = [];
        let targetQuery: Array<Step> | null = null;
        for (const field in spec) {
            if (!targetQuery) {
                targetQuery = findTarget(spec[field]);
                if (targetQuery) {
                    const join = new Join(Direction.Successor, field);
                    targetQuery.push(join);
                }
            }
            if (typeof spec[field] === "string"||
                typeof spec[field] === "number"||
                typeof spec[field] === "boolean") {
                const step = new PropertyCondition(field, spec[field]);
                steps.push(step);
            }
        }

        if (targetQuery) {
            targetQuery = targetQuery.concat(steps);
        }
        return targetQuery;
    }
    return null;
}

function parseTemplate(template: (target: any) => any): Step[] {
    const target = new ParserProxy(null, null);
    const spec = template(target);
    if (!spec) {
        throw new Error(`It looks like you didn't return j.match from the template function ${template.name}.`);
    }
    const targetJoins = findTarget(spec.template);
    if (!targetJoins) {
        throw new Error(`I can't find where you used the parameter in template function ${template.name}.`);
    }
    const steps = targetJoins.concat(spec.conditions);

    if (spec.existential) {
        return [ new ExistentialCondition(spec.negative ? Quantifier.NotExists : Quantifier.Exists, steps)];
    }
    return steps;
}

type FactConstructor<T> =
    (new (...args: any[]) => T) & {
        Type: string;
    }

export class FactDescription<T> {
    constructor(
        private fact: T
    ) { }

    has<K extends keyof T>(field: K, type: FactConstructor<T[K]> | string): FactDescription<T[K]> {
        if (type === undefined) {
            throw new Error("The `has` function now takes two parameters. Please pass the predecessor type as the second.");
        }
        const typeName = (typeof type === "string") ? type : type.Type;
        (<any>this.fact).has(field, typeName);
        return new FactDescription<T[K]>(this.fact[field]);
    }
}

export function ensure<T>(fact: T) {
    return new FactDescription<T>(fact);
}