import { Condition, Label, Match, PathCondition, Projection, Role, Specification } from "./specification";

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

    expect(symbol: string) {
        if (this.input.substring(this.offset, this.offset + symbol.length) === symbol) {
            this.offset += symbol.length;
            this.skipWhitespace();
            return true;
        }
        return false;
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
        if (!this.expect(":")) {
            throw new Error("Expected ':' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
        }
        const type = this.parseType();
        return { name, type };
    }

    parseRole(): Role {
        const name = this.parseIdentifier();
        if (!this.expect(":")) {
            throw new Error("Expected ':' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
        }
        const targetType = this.parseType();
        return { name, targetType };
    }

    parseGiven(): Label[] {
        if (!this.expect("(")) {
            throw new Error("Expected '(' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
        }
        const labels = [];
        labels.push(this.parseLabel());
        while (this.expect(",")) {
            labels.push(this.parseLabel());
        }
        if (!this.expect(")")) {
            throw new Error("Expected ')' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
        }
        return labels;
    }

    parseRoles(): Role[] {
        const roles: Role[] = [];
        while (this.expect("->")) {
            roles.push(this.parseRole());
        }
        return roles;
    }

    parsePathCondition(): PathCondition {
        const labelLeft = this.parseIdentifier();
        const rolesLeft = this.parseRoles();
        if (!this.expect("=")) {
            throw new Error("Expected '=' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
        }
        const labelRight = this.parseIdentifier();
        const rolesRight = this.parseRoles();
        return {
            type: "path",
            rolesLeft,
            labelRight,
            rolesRight
        };
    }

    parseMatch(): Match {
        const unknown = this.parseLabel();
        if (!this.expect("[")) {
            throw new Error("Expected '[' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
        }
        const conditions: Condition[] = [];
        while (!this.expect("]")) {
            conditions.push(this.parsePathCondition());
        }
        return { unknown, conditions };
    }

    parseMatches(): Match[] {
        const matches: Match[] = [];
        if (!this.expect("{")) {
            throw new Error("Expected '{' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
        }
        while (!this.expect("}")) {
            matches.push(this.parseMatch());
        }
        return matches;
    }

    parseSpecification(): Specification {
        const given = this.parseGiven();
        const matches = this.parseMatches();
        const projections: Projection[] = [];
        return { given, matches, projections };
    }
}

export function parseSpecification(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}