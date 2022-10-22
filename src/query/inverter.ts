import { Query } from './query';
import { Direction, ExistentialCondition, Join, PropertyCondition, Quantifier, Step } from './steps';

export class Inverse {
    constructor(
        public appliedToType: string,
        public affected: Query,
        public added: Query | null,
        public removed: Query | null
    ) { }
}

function optimize(steps: Array<Step>) : Array<Step> | null {
    if (steps.length > 0) {
        // Since a new fact does not yet have successors, an existential condition is always
        // true (if not exists) or false (if exists).
        if (steps[0] instanceof ExistentialCondition) {
            var condition = <ExistentialCondition>steps[0];
            if (condition.quantifier === Quantifier.Exists) {
                return null;
            }
            else {
                return optimize(steps.slice(1));
            }
        }
        // Also, successor joins are never satisfied.
        else if (steps[0] instanceof Join) {
            var join = <Join>steps[0];
            if (join.direction === Direction.Successor) {
                return null;
            }
            else {
                return steps;
            }
        }
        else {
            return steps;
        }
    }
    else {
        return steps;
    }
}

function invertSteps(steps: Array<Step>): Array<Inverse> {
    var inverses:Array<Inverse> = [];

    var oppositeSteps:Array<Step> = [];
    var appliedToType:string | null = null;
    for (var stepIndex = 0; stepIndex < steps.length; ++stepIndex) {
        var step = steps[stepIndex];

        if (step instanceof PropertyCondition) {
            oppositeSteps.unshift(step);
            if (step.name === 'type') {
                appliedToType = step.value;
            }
        }
        else if (step instanceof Join) {
            var join = <Join>step;
            oppositeSteps.unshift(new Join(
                join.direction === Direction.Predecessor ? Direction.Successor : Direction.Predecessor,
                join.role
            ));
            appliedToType = null;

            for (var conditionIndex = stepIndex + 1; conditionIndex < steps.length; ++conditionIndex) {
                var condition = steps[conditionIndex];

                if (condition instanceof PropertyCondition) {
                    oppositeSteps.unshift(condition);
                    stepIndex = conditionIndex;
                    if (condition.name === 'type') {
                        appliedToType = condition.value;
                    }
                }
                else {
                    break;
                }
            }

            if (join.direction === Direction.Successor) {
                var rest = optimize(steps.slice(stepIndex + 1));
                if (rest != null) {
                    if (!appliedToType) {
                        throw new Error('Inverse is not applied to a specific type.');
                    }
                    inverses.push(new Inverse(
                        appliedToType,
                        new Query(oppositeSteps.slice(0)),
                        new Query(rest),
                        null
                    ));
                }
            }
        }
        else if (step instanceof ExistentialCondition) {
            var existential = <ExistentialCondition>step;
            var subInverses = invertSteps(existential.steps);
            subInverses.forEach(function(subInverse: Inverse) {
                var added = existential.quantifier === Quantifier.Exists ?
                    subInverse.added != null : subInverse.removed != null;
                var remainder = new Query(subInverse.affected.steps.concat(steps.slice(stepIndex + 1)));
                inverses.push(new Inverse(
                    subInverse.appliedToType,
                    new Query(subInverse.affected.steps.concat(oppositeSteps)),
                    added ? remainder : null,
                    added ? null : remainder
                ));
            });
        }
    }
    return inverses;
}

export function invertQuery(query: Query): Array<Inverse> {
    return invertSteps(query.steps);
}
