import Interface = require("./interface");
import Query = Interface.Query;
import Direction = Interface.Direction;
import Join = Interface.Join;
import Step = Interface.Step;

export class Inverse {
    constructor(
        public affected: Query,
        public added: Query,
        public removed: Query
    ) {
    }
}

export function invertQuery(query: Query): Array<Inverse> {
    var inverses: Array<Inverse> = [];

    var oppositeSteps: Array<Step> = [];
    for (var stepIndex = 0; stepIndex < query.steps.length; ++stepIndex) {
        var step = query.steps[stepIndex];

        if (step instanceof Join) {
            var join = <Join>step;
            oppositeSteps.unshift(new Join(
                join.direction === Direction.Predecessor ? Direction.Successor : Direction.Predecessor,
                join.role
            ));

            if (join.direction === Direction.Successor) {
                inverses.push(new Inverse(
                    new Query(oppositeSteps),
                    new Query(query.steps.splice(stepIndex+1)),
                    null
                ));
            }
        }
    }
    return inverses;
}