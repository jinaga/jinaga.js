"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
function givenUserFact(identity = 'authorized-user') {
    return (0, _src_1.dehydrateFact)({
        type: 'Jinaga.User',
        publicKey: identity
    })[0];
}
function givenGroupMember() {
    return (0, _src_1.dehydrateFact)({
        type: 'Member',
        group: {
            type: 'Group',
            identity: 'known-group'
        },
        user: {
            type: 'Jinaga.User',
            publicKey: 'authorized-user'
        }
    });
}
function givenMessage(sender = 'authorized-user') {
    return (0, _src_1.dehydrateFact)({
        type: 'Message',
        author: {
            type: 'Jinaga.User',
            publicKey: sender
        }
    })[1];
}
function givenAnonymousMessage() {
    return (0, _src_1.dehydrateFact)({
        type: 'Message',
        author: null
    })[0];
}
function givenMessageFromMultipleAuthors() {
    return (0, _src_1.dehydrateFact)({
        type: 'Message',
        author: [
            {
                type: 'Jinaga.User',
                publicKey: 'authorized-user'
            }, {
                type: 'Jinaga.User',
                publicKey: 'unauthorized-user'
            }
        ]
    })[2];
}
function givenUnauthorizedMessageFromPotentiallyMultipleAuthors() {
    return (0, _src_1.dehydrateFact)({
        type: 'Message',
        author: [
            {
                type: 'Jinaga.User',
                publicKey: 'unauthorized-user'
            }
        ]
    })[1];
}
function givenMessageInGroup() {
    return (0, _src_1.dehydrateFact)({
        type: 'Message',
        group: {
            type: 'Group',
            identity: 'known-group'
        }
    })[1];
}
function givenAuthorizationRules(builder = a => a) {
    return builder(new _src_1.AuthorizationRules(model));
}
function whenAuthorize(authorizationRules, userFact, fact) {
    return __awaiter(this, void 0, void 0, function* () {
        const store = new _src_1.MemoryStore();
        const facts = [...givenGroupMember(), givenUserFact('unauthorized-user')];
        yield store.save(facts.map(f => ({ fact: f, signatures: [] })));
        const userPublicKey = userFact && userFact.fields.hasOwnProperty("publicKey")
            ? userFact.fields.publicKey : null;
        const candidateKeys = userPublicKey
            ? [userPublicKey] : [];
        const allFacts = [...facts, fact];
        const allReferences = ancestors(fact, [...facts, fact]);
        const transitiveClosure = allReferences
            .map(reference => allFacts.find((0, _src_1.factReferenceEquals)(reference)));
        const authorized = yield authorizationRules.getAuthorizedPopulation(candidateKeys, fact, transitiveClosure, store);
        return authorized.quantifier === "everyone" ||
            (authorized.quantifier === "some" && userPublicKey && authorized.authorizedKeys.indexOf(userPublicKey) >= 0);
    });
}
function ancestors(reference, facts) {
    const fact = facts.find((0, _src_1.factReferenceEquals)(reference));
    if (!fact) {
        throw new Error(`Fact ${reference.type}:${reference.hash} not found.`);
    }
    const allPredecessors = [];
    for (const predecessor of Object.values(fact.predecessors)) {
        if (Array.isArray(predecessor)) {
            allPredecessors.push(...predecessor);
        }
        else if (predecessor) {
            allPredecessors.push(predecessor);
        }
    }
    return [reference, ...allPredecessors
            .flatMap(p => ancestors(p, facts))];
}
class Group {
    constructor(identity) {
        this.identity = identity;
        this.type = Group.Type;
    }
}
Group.Type = "Group";
class Member {
    constructor(group, user) {
        this.group = group;
        this.user = user;
        this.type = Member.Type;
    }
}
Member.Type = "Member";
class Message {
    constructor(author, group) {
        this.author = author;
        this.group = group;
        this.type = Message.Type;
    }
}
Message.Type = "Message";
class Approval {
    constructor(message, approver) {
        this.message = message;
        this.approver = approver;
        this.type = Approval.Type;
    }
}
Approval.Type = "Approval";
const model = (0, _src_1.buildModel)(b => b
    .type(_src_1.User)
    .type(Group)
    .type(Member, m => m
    .predecessor("group", Group)
    .predecessor("user", _src_1.User))
    .type(Message, m => m
    .predecessor("author", _src_1.User)
    .predecessor("group", Group))
    .type(Approval, m => m
    .predecessor("message", Message)
    .predecessor("approver", _src_1.User)));
const membersOfGroup = (message, facts) => facts.ofType(Member)
    .join(member => member.group, message.group)
    .selectMany(member => facts.ofType(_src_1.User)
    .join(user => user, member.user));
describe('Authorization rules', () => {
    _src_1.Trace.off();
    it('should reject all facts by default', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules();
        const fact = givenMessage();
        const authorized = yield whenAuthorize(authorizationRules, null, fact);
        expect(authorized).toBeFalsy();
    }));
    it('should accept known facts', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .any(Message.Type));
        const fact = givenMessage();
        const authorized = yield whenAuthorize(authorizationRules, null, fact);
        expect(authorized).toBeTruthy();
    }));
    it('should reject unknown facts', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .any(Message.Type));
        const fact = givenUserFact();
        const authorized = yield whenAuthorize(authorizationRules, null, fact);
        expect(authorized).toBeFalsy();
    }));
    it('should reject known fact when not logged in', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const fact = givenMessage();
        const authorized = yield whenAuthorize(authorizationRules, null, fact);
        expect(authorized).toBeFalsy();
    }));
    it('should accept permissive fact when not logged in', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .any(Message.Type));
        const fact = givenMessage();
        const authorized = yield whenAuthorize(authorizationRules, null, fact);
        expect(authorized).toBeTruthy();
    }));
    it('should reject known fact from no user', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const userFact = givenUserFact();
        const fact = givenAnonymousMessage();
        const authorized = yield whenAuthorize(authorizationRules, userFact, fact);
        expect(authorized).toBeFalsy();
    }));
    it('should reject known fact from unauthorized user', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const userFact = givenUserFact('unauthorized-user');
        const fact = givenMessage();
        const authorized = yield whenAuthorize(authorizationRules, userFact, fact);
        expect(authorized).toBeFalsy();
    }));
    it('should accept known fact from authorized user', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const userFact = givenUserFact();
        const fact = givenMessage();
        const authorized = yield whenAuthorize(authorizationRules, userFact, fact);
        expect(authorized).toBeTruthy();
    }));
    it('should accept known fact from multiple users', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const userFact = givenUserFact();
        const fact = givenMessageFromMultipleAuthors();
        const authorized = yield whenAuthorize(authorizationRules, userFact, fact);
        expect(authorized).toBeTruthy();
    }));
    it('should reject fact from multiple users when authorized is not in list', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const userFact = givenUserFact();
        const fact = givenUnauthorizedMessageFromPotentiallyMultipleAuthors();
        const authorized = yield whenAuthorize(authorizationRules, userFact, fact);
        expect(authorized).toBeFalsy();
    }));
    it('should accept fact from a member of a group', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, membersOfGroup));
        const userFact = givenUserFact();
        const fact = givenMessageInGroup();
        const authorized = yield whenAuthorize(authorizationRules, userFact, fact);
        expect(authorized).toBeTruthy();
    }));
    it('should reject fact from a non-member of a group', () => __awaiter(void 0, void 0, void 0, function* () {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, membersOfGroup));
        const userFact = givenUserFact('unauthorized-user');
        const fact = givenMessageInGroup();
        const authorized = yield whenAuthorize(authorizationRules, userFact, fact);
        expect(authorized).toBeFalsy();
    }));
});
//# sourceMappingURL=authorizationRulesSpec.js.map