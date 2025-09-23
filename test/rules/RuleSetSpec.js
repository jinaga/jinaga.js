"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
describe("RuleSet", () => {
    it("should construct an empty rule set", () => {
        const ruleSet = _src_1.RuleSet.empty;
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(`authorization {
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(`distribution {
}
`);
    });
    it("should load empty rule set", () => {
        const ruleSet = _src_1.RuleSet.loadFromDescription("");
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(`authorization {
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(`distribution {
}
`);
    });
    it("should load only authorization", () => {
        const ruleSet = _src_1.RuleSet.loadFromDescription(`
            authorization {
                any Jinaga.User
            }
        `);
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(`authorization {
    any Jinaga.User
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(`distribution {
}
`);
    });
    it("should load only distribution", () => {
        const ruleSet = _src_1.RuleSet.loadFromDescription(`
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
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(`authorization {
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(`distribution {
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
        const ruleSet = _src_1.RuleSet.loadFromDescription(`
            purge {
                (channel: Channel) {
                    purge: Channel.Purge [
                        purge->channel: Channel = channel
                    ]
                }
            }
        `);
        expect(ruleSet.purgeConditions.saveToDescription()).toEqual(`purge {
    (channel: Channel) {
        purge: Channel.Purge [
            purge->channel: Channel = channel
        ]
    }
}
`);
    });
    it("should load authorization then distribution", () => {
        const ruleSet = _src_1.RuleSet.loadFromDescription(`
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
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(`authorization {
    any Jinaga.User
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(`distribution {
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
        const ruleSet = _src_1.RuleSet.loadFromDescription(`
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
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(`authorization {
    any Jinaga.User
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(`distribution {
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
        const ruleSet1 = _src_1.RuleSet.loadFromDescription(`
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
        const ruleSet2 = _src_1.RuleSet.loadFromDescription(`
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
        expect(ruleSet.authorizationRules.saveToDescription()).toEqual(`authorization {
    any Jinaga.User
    no ServerRequest
}
`);
        expect(ruleSet.distributionRules.saveToDescription()).toEqual(`distribution {
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
        expect(ruleSet.purgeConditions.saveToDescription()).toEqual(`purge {
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
//# sourceMappingURL=RuleSetSpec.js.map