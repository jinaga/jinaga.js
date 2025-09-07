import { AuthorizationRules, FactRecord, FactReference, FactRepository, LabelOf, MemoryStore, Trace, User, buildModel, dehydrateFact, factReferenceEquals } from "@src";


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
    const allFacts = [ ...facts, fact ];
    const allReferences = ancestors(fact, [...facts, fact]);
    const transitiveClosure = allReferences
        .map(reference => allFacts.find(factReferenceEquals(reference))!);
    const authorized = await authorizationRules.getAuthorizedPopulation(candidateKeys, fact, transitiveClosure, store);
    return authorized.quantifier === "everyone" ||
        (authorized.quantifier === "some" && userPublicKey && authorized.authorizedKeys.indexOf(userPublicKey) >= 0);
}

function ancestors(reference: FactReference, facts: FactRecord[]): FactReference[] {
    const fact = facts.find(factReferenceEquals(reference));
    if (!fact) {
        throw new Error(`Fact ${reference.type}:${reference.hash} not found.`);
    }
    const allPredecessors: FactReference[] = [];
    for (const predecessor of Object.values(fact.predecessors)) {
        if (Array.isArray(predecessor)) {
            allPredecessors.push(...predecessor);
        }
        else if (predecessor) {
            allPredecessors.push(predecessor);
        }
    }
    return [ reference, ...allPredecessors
        .flatMap(p => ancestors(p, facts))];
}

class Group {
    static Type = "Group" as const;

    type = Group.Type;
    constructor(
        public identity: string
    ) {}
}

class Member {
    static Type = "Member" as const;

    type = Member.Type;
    constructor(
        public group: Group,
        public user: User
    ) {}
}

class Message {
    static Type = "Message" as const;

    type = Message.Type;
    constructor(
        public author: User,
        public group: Group
    ) {}
}

class Approval {
    static Type = "Approval" as const;

    type = Approval.Type;
    constructor(
        public message: Message,
        public approver: User
    ) {}
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

const membersOfGroup = (message: LabelOf<Message>, facts: FactRepository) =>
    facts.ofType(Member)
        .join(member => member.group, message.group)
        .selectMany(member => facts.ofType(User)
            .join(user => user, member.user)
        );

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
            .type(Message, m => m.author));
        const userFact = givenUserFact();
        const fact = givenMessageFromMultipleAuthors();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeTruthy();
    });

    it('should reject fact from multiple users when authorized is not in list', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, m => m.author));
        const userFact = givenUserFact();
        const fact = givenUnauthorizedMessageFromPotentiallyMultipleAuthors();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeFalsy();
    });

    it('should accept fact from a member of a group', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, membersOfGroup));
        const userFact = givenUserFact();
        const fact = givenMessageInGroup();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeTruthy();
    });

    it('should reject fact from a non-member of a group', async () => {
        const authorizationRules = givenAuthorizationRules(a => a
            .type(Message, membersOfGroup));
        const userFact = givenUserFact('unauthorized-user');
        const fact = givenMessageInGroup();
        const authorized = await whenAuthorize(authorizationRules, userFact, fact);

        expect(authorized).toBeFalsy();
    });
});