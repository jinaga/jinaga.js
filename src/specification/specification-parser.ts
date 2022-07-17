import { Condition, Label, Match, PathCondition, ExistentialCondition, Projection, Role, Specification, ChildProjections } from "./specification";

class SpecificationParser {
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

    parseIdentifier(): string {
        const identifier = /[a-zA-Z_][a-zA-Z0-9_]*/;
        const match = identifier.exec(this.input.substring(this.offset));
        if (match) {
            this.offset += match[0].length;
            this.skipWhitespace();
            return match[0];
        }
        throw new Error("Expected identifier but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
    }

    parseType(): string {
        const type = /[a-zA-Z_][a-zA-Z0-9_.]*/;
        const match = type.exec(this.input.substring(this.offset));
        if (match) {
            this.offset += match[0].length;
            this.skipWhitespace();
            return match[0];
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

    parseSpecification(): Specification {
        const given = this.parseGiven();
        const { matches, labels } = this.parseMatches(given);
        const childProjections = this.parseProjections(labels);
        return { given, matches, childProjections };
    }
}

export function parseSpecification(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}
