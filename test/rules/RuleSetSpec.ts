import { RuleSet } from "../../src";

describe("RuleSet", () => {
    it("should load empty rule set", () => {
        const ruleSet = RuleSet.loadFromDescription("");
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(
`authorization {
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(
`distribution {
}
`);
    });

    it("should load only authorization", () => {
        const ruleSet = RuleSet.loadFromDescription(`
            authorization {
                any Jinaga.User
            }
        `);
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(
`authorization {
    any Jinaga.User
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(
`distribution {
}
`);
    });

    it("should load only distribution", () => {
        const ruleSet = RuleSet.loadFromDescription(`
            distribution {
                share (user: Jinaga.User) {
                    message: Message [
                        message->from: Jinaga.User = user
                    ]
                }
                with (user: Jinaga.User) {
                } => user
            }
        `);
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(
`authorization {
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(
`distribution {
    share (user: Jinaga.User) {
        message: Message [
            message->from: Jinaga.User = user
        ]
    }
    with (user: Jinaga.User) {
    } => user
}
`);
    });

    it("should load authorization then distribution", () => {
        const ruleSet = RuleSet.loadFromDescription(`
            authorization {
                any Jinaga.User
            }
            distribution {
                share (user: Jinaga.User) {
                    message: Message [
                        message->from: Jinaga.User = user
                    ]
                }
                with (user: Jinaga.User) {
                } => user
            }
        `);
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(
`authorization {
    any Jinaga.User
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(
`distribution {
    share (user: Jinaga.User) {
        message: Message [
            message->from: Jinaga.User = user
        ]
    }
    with (user: Jinaga.User) {
    } => user
}
`);
    });

    it("should load distribution then authorization", () => {
        const ruleSet = RuleSet.loadFromDescription(`
            distribution {
                share (user: Jinaga.User) {
                    message: Message [
                        message->from: Jinaga.User = user
                    ]
                }
                with (user: Jinaga.User) {
                } => user
            }
            authorization {
                any Jinaga.User
            }
        `);
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(
`authorization {
    any Jinaga.User
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(
`distribution {
    share (user: Jinaga.User) {
        message: Message [
            message->from: Jinaga.User = user
        ]
    }
    with (user: Jinaga.User) {
    } => user
}
`);
    });
});