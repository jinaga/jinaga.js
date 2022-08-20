import { encode } from "@stablelib/base64";

import { ensure, Jinaga, JinagaServer } from "./jinaga";

const host = "db";
// const host = "localhost";
const connectionString = `postgresql://dev:devpw@${host}:5432/integrationtest`;

describe("Jinaga as a device", () => {
    let j;
    let close;

    beforeEach(() => {
        ({ j, close } = JinagaServer.create({
            pgKeystore: connectionString,
            pgStore:    connectionString
        }));
    });

    afterEach(async () => {
        await close();
    });

    it("should save a fact", async () => {
        const root = await j.fact(randomRoot());

        expect(root.type).toEqual("IntegrationTest.Root");
    });

    it("should save a fact twice", async () => {
        const root = randomRoot();
        await j.fact(root);
        await j.fact(root);

        expect(root.type).toEqual("IntegrationTest.Root");
    });

    it("should save a successor fact", async () => {
        const root = await j.fact(randomRoot());

        const successor = await j.fact({
            type: "IntegrationTest.Successor",
            identifier: "test-successor",
            predecessor: root
        });

        expect(successor.identifier).toEqual("test-successor");
        expect(successor.predecessor).toEqual(root);
    });

    it("should query a successor fact", async () => {
        const root = await j.fact(randomRoot());

        const successor = await j.fact({
            type: "IntegrationTest.Successor",
            identifier: "test-successor",
            predecessor: root
        });
        const successors = await j.query(root, j.for(successorsOfRoot));

        expect(successors).toEqual([successor]);
    })

    it("should query a type that has never been seen", async () => {
        const root = await j.fact(randomRoot());
        const unknown = await j.query(root, j.for(unknownOfRoot));

        expect(unknown).toEqual([]);
    });

    it("should save a successor fact twice", async () => {
        const root = await j.fact(randomRoot());

        await j.fact({
            type: "IntegrationTest.Successor",
            identifier: "test-successor",
            predecessor: root
        });
        const successor = await j.fact({
            type: "IntegrationTest.Successor",
            identifier: "test-successor",
            predecessor: root
        });

        expect(successor.identifier).toEqual("test-successor");
        expect(successor.predecessor).toEqual(root);
    });


    it("should save multiple facts", async () => {
        const successor = await j.fact({
            type: "IntegrationTest.Successor",
            identifier: "test-successor",
            predecessor: randomRoot()
        });

        expect(successor.identifier).toEqual("test-successor");
        expect(successor.predecessor.type).toEqual("IntegrationTest.Root");
    });

    it("should get the device identity", async () => {
        const device = await j.local();

        expect(device.type).toEqual("Jinaga.Device");
    });

    it("should get device information", async () => {
        const device = await j.local();

        await j.fact({
            type: "Configuration",
            from: device
        });

        await check(async j => {
            const checkDevice = await j.local();
            expect(checkDevice).toEqual(device);

            const configurations = await j.query(checkDevice, j.for(configurationFromDevice));

            expect(configurations.length).toEqual(1);
            expect(configurations[0].type).toEqual("Configuration");
            expect(configurations[0].from.type).toEqual("Jinaga.Device");
            expect(configurations[0].from.publicKey).toEqual(checkDevice.publicKey);
        });
    });
});

describe("Jinaga as a user", () => {
    let j;
    let jDevice;
    let close;
    let done;
    let session;

    beforeEach(() => {
        const promise = new Promise((resolve) => {
            done = resolve;
        });
        ({ j: jDevice, close, withSession } = JinagaServer.create({
            pgKeystore: connectionString,
            pgStore:    connectionString,
            authorization
        }));
        session = withSession({ user: {
            provider: "test",
            id: "test-user",
            profile: {
                displayName: "Test User"
            }
        } }, async jUser => {
            j = jUser;
            await promise;
        });
    });

    afterEach(async () => {
        done();
        await session;
        await close();
    });

    it("should get the user identity", async () => {
        const user = await j.login();

        expect(user.userFact.type).toEqual("Jinaga.User");
    });

    it("should not allow an unauthorized fact", async () => {
        try {
            await j.fact({
                type: "IntegrationTest.Unauthorized",
                identifier: "test-unauthorized"
            });
            throw new Error("Expected fact to be rejected");
        }
        catch (e) {
            expect(e.message).toEqual("Rejected 1 fact of type IntegrationTest.Unauthorized.");
        }
    });

    it("should save user name", async () => {
        const { userFact: user, profile } = await j.login();

        const userName = {
            type: "MyApplication.UserName",
            value: profile.displayName,
            from: user,
            prior: []
        };
        await j.fact(userName);

        const userNames = await jDevice.query(user, Jinaga.for(namesOfUser));

        expect(userNames.length).toEqual(1);
        expect(userNames[0].value).toEqual("Test User");
    });

    it("should set default tenant", async () => {
        const { userFact: user } = await j.login();
        const device = await j.local();

        const defaultTenant = await j.fact({
            type: "MyApplication.DefaultTenant",
            tenant: {
                type: "MyApplication.Tenant",
                identifier: "test-tenant",
                creator: user
            },
            device
        });

        const defaultTenants = await jDevice.query(device, Jinaga.for(defaultTenantsOfDevice));
        expect(defaultTenants).toEqual([defaultTenant]);
    });

    it("should find no memberships", async () => {
        const { userFact: user } = await j.login();

        const memberships = await j.query(user, Jinaga.for(membershipsForUser));
        expect(memberships).toEqual([]);
    });

    it("should find assigned membership", async () => {
        const { userFact: user } = await j.login();

        const membership = await j.fact({
            type: "MyApplication.Membership",
            tenant: {
                type: "MyApplication.Tenant",
                identifier: "test-tenant",
                creator: user
            },
            user
        });

        const memberships = await j.query(user, Jinaga.for(membershipsForUser));
        expect(memberships).toEqual([membership]);
    });

    it("should not find deleted membership", async () => {
        const { userFact: user } = await j.login();

        const membership = await j.fact({
            type: "MyApplication.Membership",
            tenant: {
                type: "MyApplication.Tenant",
                identifier: "test-tenant",
                creator: user
            },
            user
        });
        await j.fact({
            type: "MyApplication.Membership.Deleted",
            membership
        });

        const memberships = await j.query(user, Jinaga.for(membershipsForUser));
        expect(memberships).toEqual([]);
    });

    it("should find restored membership", async () => {
        const { userFact: user } = await j.login();

        const membership = await j.fact({
            type: "MyApplication.Membership",
            tenant: {
                type: "MyApplication.Tenant",
                identifier: "test-tenant",
                creator: user
            },
            user
        });
        const deleted = await j.fact({
            type: "MyApplication.Membership.Deleted",
            membership
        });
        await j.fact({
            type: "MyApplication.Membership.Restored",
            deleted
        });

        const memberships = await j.query(user, Jinaga.for(membershipsForUser));
        expect(memberships).toEqual([membership]);
    });
})

function randomRoot() {
    const num = Math.random();
    const identifier = encode(num);

    return {
        type: "IntegrationTest.Root",
        identifier
    };
}

function successorsOfRoot(root) {
    return Jinaga.match({
        type: "IntegrationTest.Successor",
        predecessor: root
    });
}

function unknownOfRoot(root) {
    return Jinaga.match({
        type: "IntegrationTest.UnknownType",
        predecessor: root
    });
}

function configurationFromDevice(device) {
    return Jinaga.match({
        type: "Configuration",
        from: device
    });
}

function namesOfUser(user) {
    return Jinaga.match({
        type: "MyApplication.UserName",
        from: user
    }).suchThat(nameIsCurrent);
}

function nameIsCurrent(name) {
    return Jinaga.notExists({
        type: "MyApplication.UserName",
        prior: [name]
    });
}

function nameUser(name) {
    ensure(name).has("from", "Jinaga.User");
    return Jinaga.match(name.from);
}

function defaultTenantIsCurrent(defaultTenant) {
    return Jinaga.notExists({
        type: "MyApplication.DefaultTenant",
        prior: [defaultTenant]
    });
}

function defaultTenantsOfDevice(device) {
    return Jinaga.match({
        type: "MyApplication.DefaultTenant",
        device
    }).suchThat(defaultTenantIsCurrent);
}

function tenantCreator(tenant) {
    ensure(tenant).has("creator", "Jinaga.User");
    return Jinaga.match(tenant.creator);
}

function defaultTenantCreator(defaultTenant) {
    ensure(defaultTenant)
        .has("tenant", "MyApplication.Tenant")
        .has("creator", "Jinaga.User");
    return Jinaga.match(defaultTenant.tenant.creator);
}

function membershipsForUser(user) {
    return Jinaga.match({
        type: "MyApplication.Membership",
        user
    }).suchThat(Jinaga.not(membershipIsDeleted));
}

function membershipIsDeleted(membership) {
    return Jinaga.exists({
        type: "MyApplication.Membership.Deleted",
        membership
    }).suchThat(Jinaga.not(membershipIsRestored));
}

function membershipIsRestored(deleted) {
    return Jinaga.exists({
        type: "MyApplication.Membership.Restored",
        deleted
    });
}

function tenantOfMembership(membership) {
    ensure(membership).has("tenant", "MyApplication.Tenant");
    return Jinaga.match(membership.tenant);
}

function deletedMembership(deleted) {
    ensure(deleted).has("membership", "MyApplication.Membership");
    return Jinaga.match(deleted.membership);
}

function restoredMembership(restored) {
    ensure(restored)
        .has("deleted", "MyApplication.Membership.Deleted")
        .has("membership", "MyApplication.Membership");
    return Jinaga.match(restored.deleted.membership);
}

async function check(callback) {
    const { j, close } = JinagaServer.create({
        pgKeystore: connectionString,
        pgStore:    connectionString
    });

    try {
        await callback(j);
    }
    finally {
        await close();
    }
}

function authorization(a) {
    return a
        .type("MyApplication.UserName", Jinaga.for(nameUser))
        .type("MyApplication.Tenant", Jinaga.for(tenantCreator))
        .type("MyApplication.DefaultTenant", Jinaga.for(defaultTenantCreator))
        .type("MyApplication.Membership", Jinaga.for(tenantOfMembership).then(tenantCreator))
        .type("MyApplication.Membership.Deleted", Jinaga.for(deletedMembership).then(tenantOfMembership).then(tenantCreator))
        .type("MyApplication.Membership.Restored", Jinaga.for(restoredMembership).then(tenantOfMembership).then(tenantCreator))
        ;
}