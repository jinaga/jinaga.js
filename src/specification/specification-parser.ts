import { computeHash } from "../fact/hash";
import { HashMap } from "../fact/hydrate";
import { Declaration, DeclaredFact } from "./declaration";
import { Condition, Label, Match, PathCondition, ExistentialCondition, Projection, Role, Specification, ChildProjections } from "./specification";
import { FactRecord, PredecessorCollection } from "../storage";
import e from "express";

type FieldValue = string | number | boolean;

export class SpecificationParser {
    private offset: number = 0;

    constructor(
        private readonly input: string
    ) { }

    skipWhitespace() {
        const whitespace = /\s/;
        while (whitespace.test(this.input[this.offset])) {
            this.offset++;
        }
    }

    atEnd(): boolean {
        return this.offset >= this.input.length;
    }

    continues(symbol: string) {
        return this.input.substring(this.offset, this.offset + symbol.length) === symbol;
    }

    consume(symbol: string) {
        if (this.continues(symbol)) {
            this.offset += symbol.length;
            this.skipWhitespace();
            return true;
        }
        return false;
    }

    expect(symbol: string) {
        if (!this.consume(symbol)) {
            throw new Error(`Expected '${symbol}' but found '${this.input.substring(this.offset, this.offset + 100)}'`);
        }
    }

    match(expression: RegExp): string | null {
        const match = expression.exec(this.input.substring(this.offset));
        if (match) {
            this.offset += match[0].length;
            this.skipWhitespace();
            return match[0];
        }
        else {
            return null;
        }
    }

    parseIdentifier(): string {
        const result = this.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
        if (result !== null) {
            return result;
        }
        throw new Error("Expected identifier but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
    }

    parseType(): string {
        const type = /^[a-zA-Z_][a-zA-Z0-9_.]*/;
        const result = this.match(type);
        if (result !== null) {
            return result;
        }
        throw new Error("Expected type but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
    }

    parseLabel(): Label {
        const name = this.parseIdentifier();
        this.expect(":");
        const type = this.parseType();
        return { name, type };
    }

    parseRole(): Role {
        const name = this.parseIdentifier();
        this.expect(":");
        const targetType = this.parseType();
        return { name, targetType };
    }

    parseGiven(): Label[] {
        this.expect("(");
        if (this.continues(")")) {
            throw new Error("The specification must contain at least one given label");
        }
        const labels = [];
        labels.push(this.parseLabel());
        while (this.consume(",")) {
            labels.push(this.parseLabel());
        }
        this.expect(")");
        return labels;
    }

    parseRoles(): Role[] {
        const roles: Role[] = [];
        while (this.consume("->")) {
            roles.push(this.parseRole());
        }
        return roles;
    }

    parsePathCondition(unknown: Label, labels: Label[]): PathCondition {
        const labelLeft = this.parseIdentifier();
        if (labelLeft !== unknown.name) {
            throw new Error(`The unknown '${unknown.name}' must appear on the left side of the path`);
        }
        const rolesLeft = this.parseRoles();
        this.expect("=");
        const labelRight = this.parseIdentifier();
        if (!labels.some(label => label.name === labelRight)) {
            throw new Error(`The label '${labelRight}' has not been defined`);
        }
        const rolesRight = this.parseRoles();
        return {
            type: "path",
            rolesLeft,
            labelRight,
            rolesRight
        };
    }

    private parseExistentialCondition(labels: Label[], unknown: Label, exists: boolean): ExistentialCondition {
        const { matches } = this.parseMatches([...labels, unknown]);
        if (!matches.some(match =>
            match.conditions.some(condition =>
                condition.type === "path" &&
                condition.labelRight === unknown.name
            )
        )) {
            throw new Error(`The existential condition must be based on the unknown '${unknown.name}'`);
        }
        return {
            type: "existential",
            exists,
            matches
        };
    }

    parseCondition(unknown: Label, labels: Label[]): Condition {
        if (this.consume("!")) {
            this.expect("E");
            return this.parseExistentialCondition(labels, unknown, false);
        }
        else if (this.consume("E")) {
            return this.parseExistentialCondition(labels, unknown, true);
        }
        else {
            return this.parsePathCondition(unknown, labels);
        }
    }

    parseMatch(labels: Label[]): Match {
        const unknown = this.parseLabel();
        if (labels.some(label => label.name === unknown.name)) {
            throw new Error(`The name '${unknown.name}' has already been used`);
        }
        this.expect("[");
        if (this.continues("]")) {
            throw new Error(`The match for '${unknown.name}' has no conditions`);
        }
        const conditions: Condition[] = [];
        while (!this.consume("]")) {
            conditions.push(this.parseCondition(unknown, labels));
        }
        return { unknown, conditions };
    }

    parseMatches(labels: Label[]): { matches: Match[], labels: Label[] } {
        const matches: Match[] = [];
        this.expect("{");
        if (this.continues("}")) {
            throw new Error("The specification must contain at least one match");
        }
        while (!this.consume("}")) {
            const match = this.parseMatch(labels);
            labels = [ ...labels, match.unknown ];
            matches.push(match);
        }
        return { matches, labels };
    }

    parseProjection(labels: Label[]): Projection {
        const name = this.parseIdentifier();
        this.expect("=");
        if (this.continues("{")) {
            const { matches, labels: allLabels } = this.parseMatches(labels);
            const projections = this.parseProjections(allLabels);
            return { type: "specification", name, matches, childProjections: projections };
        }
        else {
            const label = this.parseIdentifier();
            this.expect(".");
            const field = this.parseIdentifier();
            return { type: "field", name, label, field };
        }
    }

    parseProjections(labels: Label[]): ChildProjections {
        if (!this.consume("=>")) {
            return [];
        }
        if (this.continues("{")) {
            this.consume("{");
            const projections: Projection[] = [];
            while (!this.consume("}")) {
                const projection = this.parseProjection(labels);
                projections.push(projection);
            }
            return projections;
        }
        else {
            const label = this.parseIdentifier();
            this.expect(".");
            const field = this.parseIdentifier();
            return { label, field };
        }
    }

    private parseValue(knownFacts: Declaration): FieldValue | DeclaredFact {
        const jsonValue = /^true|^false|^null|^"(?:[^"\\]|\\.)*"|^[+-]?\d+(\.\d+)?/;
        const value = this.match(jsonValue);
        if (value) {
            // The string matches a JSON literal value, so this is a field.
            return JSON.parse(value) as FieldValue;
        }
        else {
            // The string does not match a JSON literal value, so this is a declared fact.
            const reference = this.parseIdentifier();
            if (!knownFacts[reference]) {
                throw new Error(`The fact '${reference}' has not been defined`);
            }
            return knownFacts[reference];
        }
    }

    private parseField(fields: {}, predecessors: PredecessorCollection, knownFacts: Declaration) : {
        fields: {},
        predecessors: PredecessorCollection
    } {
        const name = this.parseIdentifier();
        if (!this.continues(":")) {
            // This is an auto-named element, which must be a predecessor
            if (!knownFacts[name]) {
                throw new Error(`The fact '${name}' has not been defined`);
            }
            return {
                fields,
                predecessors: {
                    ...predecessors,
                    [name]: knownFacts[name].reference
                }
            }
        }
        else {
            // This is a named element, which could be a field or a predecessor
            this.consume(":");
            const value = this.parseValue(knownFacts);
            if (typeof value === "object") {
                // The value is a predecessor
                return {
                    fields,
                    predecessors: {
                        ...predecessors,
                        [name]: value.reference
                    }
                };
            }
            else {
                // The value is a field
                return {
                    fields: {
                        ...fields,
                        [name]: value
                    },
                    predecessors
                };
            }
        }
    }

    private parseFact(type: string, knownFacts: Declaration): DeclaredFact {
        if (this.consume("{")) {
            let fields: {} = {};
            let predecessors: PredecessorCollection = {};
            if (!this.continues("}")) {
                ({fields, predecessors} = this.parseField(fields, predecessors, knownFacts));
                while (this.consume(",")) {
                    ({fields, predecessors} = this.parseField(fields, predecessors, knownFacts));
                }
            }
            this.expect("}");
            const hash = computeHash(fields, predecessors);
            return {
                fact: {
                    type,
                    hash,
                    fields,
                    predecessors
                },
                reference: {
                    type,
                    hash,
                }
            };
        }
        else if (this.consume("#")) {
            const hash = this.match(/[A-Za-z0-9+/]+={0,2}/);
            return {
                fact: null,
                reference: {
                    type,
                    hash,
                }
            };
        }
        else {
            const reference = this.parseIdentifier();
            if (!knownFacts[reference]) {
                throw new Error(`The fact '${reference}' has not been defined`);
            }
            const knownFact = knownFacts[reference];
            if (knownFact.reference.type !== type) {
                throw new Error(`Cannot assign a '${knownFact.reference.type}' to a '${type}'`);
            }
            return knownFact;
        }
    }

    parseSpecification(): Specification {
        const given = this.parseGiven();
        const { matches, labels } = this.parseMatches(given);
        const childProjections = this.parseProjections(labels);
        return { given, matches, childProjections };
    }

    parseDeclaration(knownFacts: Declaration): Declaration {
        let result: Declaration = {};
        while (this.consume("let")) {
            const name = this.parseIdentifier();
            if (result[name] || knownFacts[name]) {
                throw new Error(`The name '${name}' has already been used`);
            }
            this.expect(":");
            const type = this.parseType();
            this.expect("=");
            const value = this.parseFact(type, { ...knownFacts, ...result });
            result[name] = value;
        }
        return result;
    }
}
