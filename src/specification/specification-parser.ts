import { AuthorizationRuleAny, AuthorizationRuleNone, AuthorizationRules, AuthorizationRuleSpecification } from "../authorization/authorizationRules";
import { DistributionRules } from "../distribution/distribution-rules";
import { computeHash } from "../fact/hash";
import { PurgeConditions } from "../purge/purgeConditions";
import { PredecessorCollection } from "../storage";
import { Declaration, DeclaredFact } from "./declaration";
import { Condition, ExistentialCondition, Label, Match, NamedComponentProjection, PathCondition, Projection, Role, Specification } from "./specification";
import { enforceConnectivityValidation } from "./connectivity";

type FieldValue = string | number | boolean;

export class Invalid extends Error {
    __proto__: Error;
    constructor(message?: string) {
        const trueProto = new.target.prototype;
        super(message);

        this.__proto__ = trueProto;
    }
}

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

    atEnd() {
        return this.offset >= this.input.length;
    }

    expectEnd() {
        if (this.offset < this.input.length) {
            throw new Invalid(`Expected end of input but found '${this.previewText()}'`);
        }
    }

    private previewText() {
        return this.input.substring(this.offset, this.offset + 100);
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
            throw new Invalid(`Expected '${symbol}' but found '${this.previewText()}'`);
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
        throw new Invalid("Expected identifier but found '" + this.previewText() + "'");
    }

    parseType(): string {
        const type = /^[a-zA-Z_][a-zA-Z0-9_.]*/;
        const result = this.match(type);
        if (result !== null) {
            return result;
        }
        throw new Invalid("Expected type but found '" + this.previewText() + "'");
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
            throw new Invalid("The specification must contain at least one given label");
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
            throw new Invalid(`The unknown '${unknown.name}' must appear on the left side of the path`);
        }
        const rolesLeft = this.parseRoles();
        this.expect("=");
        const labelRight = this.parseIdentifier();
        if (!labels.some(label => label.name === labelRight)) {
            throw new Invalid(`The label '${labelRight}' has not been defined`);
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
            throw new Invalid(`The existential condition must be based on the unknown '${unknown.name}'`);
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
            throw new Invalid(`The name '${unknown.name}' has already been used`);
        }
        this.expect("[");
        if (this.continues("]")) {
            throw new Invalid(`The match for '${unknown.name}' has no conditions`);
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
            if (this.consume(".")) {
                const field = this.parseIdentifier();
                return { type: "field", name, label, field };
            }
            else {
                return { type: "fact", name, label };
            }
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
        else if (this.consume("#")) {
            const label = this.parseIdentifier();
            return {
                type: "hash",
                label
            };
        }
        else {
            const label = this.parseIdentifier();
            if (this.consume(".")) {
                const field = this.parseIdentifier();
                return {
                    type: "field",
                    label,
                    field
                };
            }
            else {
                return {
                    type: "fact",
                    label
                };
            }
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
            throw new Invalid(`The fact '${reference}' has not been defined`);
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
                throw new Invalid(`The fact '${name}' has not been defined`);
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
                throw new Invalid("The hash must be a base64-encoded string");
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
                throw new Invalid(`The fact '${reference}' has not been defined`);
            }
            const knownFact = fact.declared;
            if (knownFact.reference.type !== type) {
                throw new Invalid(`Cannot assign a '${knownFact.reference.type}' to a '${type}'`);
            }
            return knownFact;
        }
    }

    parseSpecification(): Specification {
        const given = this.parseGiven();
        const { matches, labels } = this.parseMatches(given);
        const projection = this.parseProjection(labels);
        const specification = { given, matches, projection };
        // Validate connectivity early for DSL-parsed specifications
        enforceConnectivityValidation(specification);
        return specification;
    }

    parseDeclaration(knownFacts: Declaration): Declaration {
        let result: Declaration = knownFacts;
        while (this.consume("let")) {
            const name = this.parseIdentifier();
            if (result.some(r => r.name === name)) {
                throw new Invalid(`The name '${name}' has already been used`);
            }
            this.expect(":");
            const type = this.parseType();
            this.expect("=");
            const value = this.parseFact(type, result);
            result = [ ...result, { name, declared: value } ];
        }
        return result;
    }

    parseAuthorizationRules(): AuthorizationRules {
        let authorizationRules = new AuthorizationRules(undefined);

        this.expect("authorization");
        this.expect("{");
        while (!this.consume("}")) {
            if (this.consume("any")) {
                const type = this.parseType();
                authorizationRules = AuthorizationRules.combine(authorizationRules, type, new AuthorizationRuleAny());
            }
            else if (this.consume("no")) {
                const type = this.parseType();
                authorizationRules = AuthorizationRules.combine(authorizationRules, type, new AuthorizationRuleNone());
            }
            else {
                const specification = this.parseSpecification();
                if (specification.given.length !== 1) {
                    throw new Invalid("A specification in an authorization rule must have exactly one given label");
                }
                const type = specification.given[0].type;
                authorizationRules = AuthorizationRules.combine(authorizationRules, type, new AuthorizationRuleSpecification(specification));
            }
        }

        return authorizationRules;
    }

    parseDistributionRules(): DistributionRules {
        let distributionRules = new DistributionRules([]);

        this.expect("distribution");
        this.expect("{");
        while (!this.consume("}")) {
            this.expect("share");
            const specification = this.parseSpecification();
            this.expect("with");
            let user: Specification | null = null;
            if (!this.consume("everyone")) {
                user = this.parseSpecification();
            }
            distributionRules = DistributionRules.combine(distributionRules, specification, user);
        }

        return distributionRules;
    }

    parsePurgeConditions(): PurgeConditions {
        let purgeConditions = new PurgeConditions([]);

        this.expect("purge");
        this.expect("{");
        while (!this.consume("}")) {
            const specification = this.parseSpecification();
            purgeConditions = new PurgeConditions([
                ...purgeConditions.specifications,
                specification
            ]);
        }

        return purgeConditions
    }
}
