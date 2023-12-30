import { User, buildModel } from "../../src";
import { AuthorizationRules } from '../../src/authorization/authorizationRules';
import { dehydrateFact } from '../../src/fact/hydrate';
import { ensure, Jinaga as j } from '../../src/jinaga';
import { MemoryStore } from '../../src/memory/memory-store';
import { FactRecord } from '../../src/storage';
import { Trace } from '../../src/util/trace';


function givenUserFact(identity = 'authorized-user') {
    return dehydrateFact({
        type: 'Jinaga.User',
        publicKey: identity
    })[0];
}

function givenGroupMember() {
    return dehydrateFact({
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
    return dehydrateFact({
        type: 'Message',
        author: {
            type: 'Jinaga.User',
            publicKey: sender
        }
    })[1];
}

function givenAnonymousMessage() {
    return dehydrateFact({
        type: 'Message',
        author: null
    })[0];
}

function givenMessageFromMultipleAuthors() {
    return dehydrateFact({
        type: 'Message',
        author: [
            {
                type: 'Jinaga.User',
                publicKey: 'authorized-user'
            },{
                type: 'Jinaga.User',
                publicKey: 'unauthorized-user'
            }
        ]
    })[2];
}

function givenUnauthorizedMessageFromPotentiallyMultipleAuthors() {
    return dehydrateFact({
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
    return dehydrateFact({
        type: 'Message',
        group: {
            type: 'Group',
            identity: 'known-group'
        }
    })[1];
}

function givenAuthorizationRules(builder: (a: AuthorizationRules) => AuthorizationRules =
        a => a) {
    return builder(new AuthorizationRules(model));
}

async function whenAuthorize(authorizationRules: AuthorizationRules, userFact: FactRecord | null, fact: FactRecord) {
    const store = new MemoryStore();
    const facts = [ ...givenGroupMember(), givenUserFact('unauthorized-user') ];
    await store.save(facts.map(f => ({ fact: f, signatures: [] })));
    const userPublicKey = userFact && userFact.fields.hasOwnProperty("publicKey")
        ? userFact.fields.publicKey : null;
    const candidateKeys = userPublicKey
        ? [ userPublicKey ] : [];
    const authorized = await authorizationRules.getAuthorizedPopulation(candidateKeys, fact, facts, store);
    return authorized.quantifier === "everyone" ||
        (authorized.quantifier === "some" && userPublicKey && authorized.authorizedKeys.indexOf(userPublicKey) >= 0);
}

class Group {
    static Type = "Group" as const;

    type = Group.Type;
    constructor(
        public identity: string
    ) {}

    static members(g: Group) {
        return j.match<Member>({
            type: Member.Type,
            group: g
        });
    }
}

class Member {
    static Type = "Member" as const;

    type = Member.Type;
    constructor(
        public group: Group,
        public user: User
    ) {}

    static user(m: Member) {
        ensure(m).has("user", User);

        return j.match(m.user);
    }
}

class Message {
    static Type = "Message" as const;

    type = Message.Type;
    constructor(
        public author: User,
        public group: Group
    ) {}

    static authorOf(m: Message) {
        ensure(m).has("author", User);

        return j.match(m.author);
    }

    static group(m: Message) {
        ensure(m).has("group", Group);

        return j.match(m.group);
    }
}

class Approval {
    static Type = "Approval" as const;

    type = Approval.Type;
    constructor(
        public message: Message,
        public approver: User
    ) {}

    static of(m: Message) {
        return j.match<Approval>({
            type: Approval.Type,
            message: m
        });
    }

    static by(a: Approval) {
        ensure(a).has("approver", User);

        return j.match(a.approver);
    }
}

const model = buildModel(b => b
    .type(User)
    .type(Group)
    .type(Member, m => m
        .predecessor("group", Group)
        .predecessor("user", User)
    )
    .type(Message, m => m
        .predecessor("author", User)
        .predecessor("group", Group)
    )
    .type(Approval, m => m
        .predecessor("message", Message)
        .predecessor("approver", User)
    )
);

function emptyQuery(m: Message) {
    return j.match(m);
}

function typeQuery(m: Message) {
    ensure(m).has("author", User);
    m.type = Message.Type;

    return j.match(m.author);
}

describe('Authorization rules', () => {
    Trace.off();
    
    it('should reject all facts by default', async () => {
        const authorizationRules = givenAuthorizationRules();
        const fact = givenMessage();
        const authorized = await whenAuthorize(authorizationRules, null, fact);

        expect(authorized).toBeFalsy();
    });

    it('should accept known facts', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .any(Message.Type));
        const fact = givenMessage();
        const authorized = await whenAuthorize(authorizationRules, null, fact);

        expect(authorized).toBeTruthy();
    });

    it('should reject unknown facts', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .any(Message.Type));
        const fact = givenUserFact();
        const authorized = await whenAuthorize(authorizationRules, null, fact);

        expect(authorized).toBeFalsy();
    });

    it('should reject known fact when not logged in', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const fact = givenMessage();
        const authorized = await whenAuthorize(authorizationRules, null, fact);

        expect(authorized).toBeFalsy();
    });

    it('should accept permissive fact when not logged in', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .any(Message.Type));
        const fact = givenMessage();
        const authorized = await whenAuthorize(authorizationRules, null, fact);

        expect(authorized).toBeTruthy();
    });

    it('should reject known fact from no user', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const userFact = givenUserFact();
        const fact = givenAnonymousMessage();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeFalsy();
    });

    it('should reject known fact from unauthorized user', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const userFact = givenUserFact('unauthorized-user');
        const fact = givenMessage();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeFalsy();
    });

    it('should accept known fact from authorized user', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const userFact = givenUserFact();
        const fact = givenMessage();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeTruthy();
    });

    it('should accept known fact from multiple users', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message.Type, j.for(Message.authorOf)));
        const userFact = givenUserFact();
        const fact = givenMessageFromMultipleAuthors();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeTruthy();
    });

    it('should reject fact from multiple users when authorized is not in list', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message.Type, j.for(Message.authorOf)));
        const userFact = givenUserFact();
        const fact = givenUnauthorizedMessageFromPotentiallyMultipleAuthors();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeFalsy();
    });

    it('should accept fact from a member of a group', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message.Type, j.for(Message.group).then(Group.members).then(Member.user)));
        const userFact = givenUserFact();
        const fact = givenMessageInGroup();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeTruthy();
    });

    it('should reject fact from a non-member of a group', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message.Type, j.for(Message.group).then(Group.members).then(Member.user)));
        const userFact = givenUserFact('unauthorized-user');
        const fact = givenMessageInGroup();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeFalsy();
    });

    it('should throw on empty query', async () => {
        expect(() => givenAuthorizationRules(a => a
            .type(Message.Type, j.for(emptyQuery)))).toThrow(
                'Invalid authorization rule for type Message: the query matches the fact itself.'
            );
    });

    it('should throw on successor query', async () => {
        expect(() => givenAuthorizationRules(a => a
            .type(Message.Type, j.for(Approval.of).then(Approval.by)))).toThrow(
                'Invalid authorization rule for type Message: the query expects successors.'
            );
    });

    it('should throw on query that doesn\'t start with a join', async () => {
        expect(() => givenAuthorizationRules(a => a
            .type(Message.Type, j.for(typeQuery)))).toThrow(
                'Invalid authorization rule for type Message: the query does not begin with a predecessor.'
            );
    });
});