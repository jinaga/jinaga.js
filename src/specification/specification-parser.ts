import { Condition, Label, Match, PathCondition, ExistentialCondition, Projection, Role, Specification } from "./specification";

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
        if (this.expect(")")) {
            throw new Error("The specification must contain at least one given label");
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

    parsePathCondition(unknown: Label, labels: Label[]): PathCondition {
        const labelLeft = this.parseIdentifier();
        if (labelLeft !== unknown.name) {
            throw new Error(`The unknown '${unknown.name}' must appear on the left side of the path`);
        }
        const rolesLeft = this.parseRoles();
        if (!this.expect("=")) {
            throw new Error("Expected '=' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
        }
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
        const matches = this.parseMatches([...labels, unknown]);
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
        if (this.expect("!")) {
            if (!this.expect("E")) {
                throw new Error("Expected 'E' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
            }
            return this.parseExistentialCondition(labels, unknown, false);
        }
        else if (this.expect("E")) {
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
        if (!this.expect("[")) {
            throw new Error("Expected '[' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
        }
        if (this.expect("]")) {
            throw new Error(`The match for '${unknown.name}' has no conditions`);
        }
        const conditions: Condition[] = [];
        while (!this.expect("]")) {
            conditions.push(this.parseCondition(unknown, labels));
        }
        return { unknown, conditions };
    }

    parseMatches(labels: Label[]): Match[] {
        const matches: Match[] = [];
        if (!this.expect("{")) {
            throw new Error("Expected '{' but found '" + this.input.substring(this.offset, this.offset + 100) + "'");
        }
        if (this.expect("}")) {
            throw new Error("The specification must contain at least one match");
        }
        while (!this.expect("}")) {
            const match = this.parseMatch(labels);
            labels = [ ...labels, match.unknown ];
            matches.push(match);
        }
        return matches;
    }

    parseSpecification(): Specification {
        const given = this.parseGiven();
        const matches = this.parseMatches(given);
        const clusters = matches.reduce(
            mergeClusters,
            given.map(label => [ label ]));
        if (clusters.length > 1) {
            throw new Error("The graph is not connected");
        }
        const projections: Projection[] = [];
        return { given, matches, projections };
    }
}

export function parseSpecification(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

function mergeClusters(clusters: Label[][], match: Match): Label[][] {
    const joinedLabels = match.conditions
        .filter(condition => condition.type === "path")
        .map((condition: PathCondition) => condition.labelRight);
    const joinedClusters = clusters
        .filter(cluster => cluster
            .some(label => joinedLabels.includes(label.name))
        );
    const remainingClusters = clusters
        .filter(cluster => !joinedClusters.includes(cluster));
    const mergedCluster = [
        ...joinedClusters.flat(),
        match.unknown
    ];
    return [
        ...remainingClusters,
        mergedCluster
    ];
}
