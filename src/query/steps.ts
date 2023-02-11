export enum Direction {
    Predecessor,
    Successor
}

export enum Quantifier {
    Exists,
    NotExists
}

export class Step {
    public toDeclarativeString(): string {
        throw Error("Abstract");
    }
}

export class ExistentialCondition extends Step {
    constructor(
        public quantifier: Quantifier,
        public steps: Array<Step>
    ) { super(); }

    public toDeclarativeString(): string {
        return (this.quantifier === Quantifier.Exists ? "E(" : "N(") +
            this.steps.map(s => s.toDeclarativeString()).join(" ") + ")";
    }
}

export class PropertyCondition extends Step {
    constructor(
        public name: string,
        public value: any
    ) { super(); }

    public toDeclarativeString(): string {
        return "F." + this.name + "=\"" + this.value + "\"";
    }
}

export class Join extends Step {
    constructor(
        public direction: Direction,
        public role: string
    ) { super(); }

    public toDeclarativeString(): string {
        return (this.direction === Direction.Predecessor ? "P." : "S.") + this.role;
    }
}
