import { RuleSet } from "@src";

describe("RuleSet", () => {
    it("should construct an empty rule set", () => {
        const ruleSet = RuleSet.empty;
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(
`authorization {
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(
`distribution {
}
`);
    });

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

    it("should load only purge", () => {
        const ruleSet = RuleSet.loadFromDescription(`
            purge {
                (channel: Channel) {
                    purge: Channel.Purge [
                        purge->channel: Channel = channel
                    ]
                }
            }
        `);
        expect(ruleSet.purgeConditions.saveToDescription()).toEqual(
`purge {
    (channel: Channel) {
        purge: Channel.Purge [
            purge->channel: Channel = channel
        ]
    }
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

    it("should merge rule sets", () => {
        const ruleSet1 = RuleSet.loadFromDescription(`
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
            purge {
                (channel: Channel) {
                    purge: Channel.Purge [
                        purge->channel: Channel = channel
                    ]
                }
            }
        `);
        const ruleSet2 = RuleSet.loadFromDescription(`
            authorization {
                no ServerRequest
            }
            distribution {
                share (user: Jinaga.User) {
                    announcement: Announcement [
                        announcement->from: Jinaga.User = user
                    ]
                }
                with everyone
            }
            purge {
                (group: Group) {
                    purge: Group.Purge [
                        purge->group: Group = group
                    ]
                }
            }
        `);
        const ruleSet = ruleSet1.merge(ruleSet2);
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(
`authorization {
    any Jinaga.User
    no ServerRequest
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
    share (user: Jinaga.User) {
        announcement: Announcement [
            announcement->from: Jinaga.User = user
        ]
    }
    with everyone
}
`);
        expect(ruleSet.purgeConditions.saveToDescription()).toEqual(
`purge {
    (channel: Channel) {
        purge: Channel.Purge [
            purge->channel: Channel = channel
        ]
    }
    (group: Group) {
        purge: Group.Purge [
            purge->group: Group = group
        ]
    }
}
`);
    });
});