import { computeHash } from "../fact/hash";
import { PredecessorCollection } from "../storage";
import { Declaration, DeclaredFact } from "./declaration";
import { Condition, ExistentialCondition, Label, Match, NamedComponentProjection, PathCondition, Projection, Role, Specification } from "./specification";

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
        const predecessorType = this.parseType();
        return { name, predecessorType };
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

    parseComponent(labels: Label[]): NamedComponentProjection {
        const name = this.parseIdentifier();
        this.expect("=");
        if (this.continues("{")) {
            const { matches, labels: allLabels } = this.parseMatches(labels);
            const projection = this.parseProjection(allLabels);
            return { type: "specification", name, matches, projection: projection };
        }
        else if (this.consume("#")) {
            const label = this.parseIdentifier();
            return { type: "hash", name, label };
        }
        else {
            const label = this.parseIdentifier();
            this.expect(".");
            const field = this.parseIdentifier();
            return { type: "field", name, label, field };
        }
    }

    parseProjection(labels: Label[]): Projection {
        if (!this.consume("=>")) {
            return {
                type: "composite",
                components: []
            };
        }
        if (this.continues("{")) {
            this.consume("{");
            const components: NamedComponentProjection[] = [];
            while (!this.consume("}")) {
                const component = this.parseComponent(labels);
                components.push(component);
            }
            return {
                type: "composite",
                components
            };
        }
        else {
            const label = this.parseIdentifier();
            this.expect(".");
            const field = this.parseIdentifier();
            return {
                type: "field",
                label,
                field
            };
        }
    }

    private parseValue(knownFacts: Declaration): FieldValue | DeclaredFact | DeclaredFact[] {
        const jsonValue = /^true|^false|^null|^"(?:[^"\\]|\\.)*"|^[+-]?\d+(\.\d+)?/;
        const value = this.match(jsonValue);
        if (value) {
            // The string matches a JSON literal value, so this is a field.
            return JSON.parse(value) as FieldValue;
        }
        else if (this.continues("[")) {
            // This is an array of facts.
            const facts: DeclaredFact[] = [];
            this.consume("[");
            if (!this.continues("]")) {
                facts.push(this.parseFactReference(knownFacts));
                while (this.consume(",")) {
                    facts.push(this.parseFactReference(knownFacts));
                }
            }
            this.expect("]");
            return facts;
        }
        else {
            // The string does not match a JSON literal value, so this is a fact reference.
            return this.parseFactReference(knownFacts);
        }
    }

    private parseFactReference(knownFacts: Declaration): DeclaredFact {
        const reference = this.parseIdentifier();
        const fact = knownFacts.find(fact => fact.name === reference);
        if (!fact) {
            throw new Error(`The fact '${reference}' has not been defined`);
        }
        return fact.declared;
    }

    private parseField(fields: {}, predecessors: PredecessorCollection, knownFacts: Declaration) : {
        fields: {},
        predecessors: PredecessorCollection
    } {
        const name = this.parseIdentifier();
        if (!this.continues(":")) {
            // This is an auto-named element, which must be a predecessor
            const fact = knownFacts.find(fact => fact.name === name);
            if (!fact) {
                throw new Error(`The fact '${name}' has not been defined`);
            }
            return {
                fields,
                predecessors: {
                    ...predecessors,
                    [name]: fact.declared.reference
                }
            }
        }
        else {
            // This is a named element, which could be a field or a predecessor
            this.consume(":");
            const value = this.parseValue(knownFacts);
            if (typeof value === "object") {
                if (Array.isArray(value)) {
                    // The value is an array of predecessors
                    return {
                        fields,
                        predecessors: {
                            ...predecessors,
                            [name]: value.map(predecessor => predecessor.reference)
                        }
                    };
                }
                else {
                    // The value is a single predecessor
                    return {
                        fields,
                        predecessors: {
                            ...predecessors,
                            [name]: value.reference
                        }
                    };
                }
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
            if (!hash) {
                throw new Error("The hash must be a base64-encoded string");
            }
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
            const fact = knownFacts.find(fact => fact.name === reference);
            if (!fact) {
                throw new Error(`The fact '${reference}' has not been defined`);
            }
            const knownFact = fact.declared;
            if (knownFact.reference.type !== type) {
                throw new Error(`Cannot assign a '${knownFact.reference.type}' to a '${type}'`);
            }
            return knownFact;
        }
    }

    parseSpecification(): Specification {
        const given = this.parseGiven();
        const { matches, labels } = this.parseMatches(given);
        const projection = this.parseProjection(labels);
        return { given, matches, projection };
    }

    parseDeclaration(knownFacts: Declaration): Declaration {
        let result: Declaration = [];
        while (this.consume("let")) {
            const name = this.parseIdentifier();
            if (result.some(r => r.name === name) || knownFacts.some(r => r.name === name)) {
                throw new Error(`The name '${name}' has already been used`);
            }
            this.expect(":");
            const type = this.parseType();
            this.expect("=");
            const value = this.parseFact(type, [ ...knownFacts, ...result ]);
            result = [ ...result, { name, declared: value } ];
        }
        return result;
    }
}
