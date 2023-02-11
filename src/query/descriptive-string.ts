import { Query } from './query';
import { Direction, ExistentialCondition, Join, PropertyCondition, Quantifier, Step } from './steps';

function done(descriptive: string, index: number): boolean {
    return index === descriptive.length || lookahead(descriptive, index) === ")";
}

function lookahead(descriptive: string, index: number): string {
    if (descriptive.length <= index) {
        throw Error("Malformed descriptive string " + descriptive + " at " + index +
            ". Reached the end of the string prematurely.");
    }
    return descriptive.charAt(index);
}

function consume(descriptive: string, index: number, expected: string): number {
    if (lookahead(descriptive, index) !== expected) {
        throw Error("Malformed descriptive string " + descriptive + " at " + index +
            ". Expecting " + expected + " but found " + lookahead(descriptive, index) + ".");
    }
    return index + 1;
}

function identifier(descriptive: string, index: number): {id: string, index: number} {
    var id = "";
    while (
        !done(descriptive, index) &&
        lookahead(descriptive, index) !== " " &&
        lookahead(descriptive, index) !== "=") {

        var next = lookahead(descriptive, index);
        index = consume(descriptive, index, next);
        id = id + next;
    }
    return {id, index};
}

function quotedValue(descriptive: string, index: number): {value: string, index: number} {
    var value = "";
    index = consume(descriptive, index, "\"");
    while (lookahead(descriptive, index) !== "\"") {
        var next = lookahead(descriptive, index);
        index = consume(descriptive, index, next);
        value = value + next;
    }
    index = consume(descriptive, index, "\"");
    return {value, index};
}

export function fromDescriptiveString(descriptive: string) {
    const result = parseDescriptiveString(descriptive, 0);
    return new Query(result.steps);
}

function parseDescriptiveString(descriptive: string, index: number): {steps: Array<Step>, index: number} {
    if (done(descriptive, index)) {
        return { steps: [], index };
    }

    var steps: Array<Step> = [];
    while (true) {
        var next = lookahead(descriptive, index);
        if (next === "P" || next === "S") {
            index = consume(descriptive, index, next);
            index = consume(descriptive, index, ".");
            var {id, index} = identifier(descriptive, index);
            var join = new Join(
                next === "P" ? Direction.Predecessor : Direction.Successor,
                id);
            steps.push(join);
        }
        else if (next === "F") {
            index = consume(descriptive, index, "F");
            index = consume(descriptive, index, ".");
            var {id, index} = identifier(descriptive, index);
            index = consume(descriptive, index, "=");
            var {value, index} = quotedValue(descriptive, index);
            var property = new PropertyCondition(id, value);
            steps.push(property);
        }
        else if (next === "N" || next === "E") {
            index = consume(descriptive, index, next);
            index = consume(descriptive, index, "(");
            var childQuery = parseDescriptiveString(descriptive, index);
            index = childQuery.index;
            index = consume(descriptive, index, ")");
            var step = new ExistentialCondition(
                next === "N" ? Quantifier.NotExists : Quantifier.Exists,
                childQuery.steps);
            steps.push(step);
        }
        else {
            throw Error("Malformed descriptive string " + descriptive + " at " + index);
        }

        if (done(descriptive, index)) {
            return { steps, index };
        }
        index = consume(descriptive, index, " ");
    }
}
