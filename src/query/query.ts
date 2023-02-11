import { Step, Join, Direction, ExistentialCondition } from './steps';

function hasSuccessor(steps: Step[]): boolean {
    return steps.some(step =>
        (step instanceof Join && step.direction === Direction.Successor) ||
        (step instanceof ExistentialCondition && hasSuccessor(step.steps))
    );
}

export class Query {
    private pathLength: number;

    constructor(
        public steps: Array<Step>
    ) {
        this.pathLength = this.steps.filter(step => step instanceof Join).length;
    }

    public concat(other: Query): Query {
        return new Query(this.steps.concat(other.steps));
    }

    public toDescriptiveString(): string {
        return this.steps.map(s => s.toDeclarativeString()).join(" ");
    }

    public isDeterministic() {
        return !hasSuccessor(this.steps);
    }

    public getPathLength() {
        return this.pathLength;
    }
}
