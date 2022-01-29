const { expect } = require("chai");
const { Jinaga, JinagaServer, ensure } = require("./jinaga");
const forge = require("node-forge");

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

        expect(root.type).to.equal("IntegrationTest.Root");
    });

    it("should save a fact twice", async () => {
        const root = randomRoot();
        await j.fact(root);
        await j.fact(root);

        expect(root.type).to.equal("IntegrationTest.Root");
    });

    it("should save a successor fact", async () => {
        const root = await j.fact(randomRoot());

        const successor = await j.fact({
            type: "IntegrationTest.Successor",
            identifier: "test-successor",
            predecessor: root
        });

        expect(successor.identifier).to.equal("test-successor");
        expect(successor.predecessor).to.deep.equal(root);
    });

    it("should query a successor fact", async () => {
        const root = await j.fact(randomRoot());

        const successor = await j.fact({
            type: "IntegrationTest.Successor",
            identifier: "test-successor",
            predecessor: root
        });
        const successors = await j.query(root, j.for(successorsOfRoot));

        expect(successors).to.deep.equal([successor]);
    })

    it("should query a type that has never been seen", async () => {
        const root = await j.fact(randomRoot());
        const unknown = await j.query(root, j.for(unknownOfRoot));

        expect(unknown).to.deep.equal([]);
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

        expect(successor.identifier).to.equal("test-successor");
        expect(successor.predecessor).to.deep.equal(root);
    });


    it("should save multiple facts", async () => {
        const successor = await j.fact({
            type: "IntegrationTest.Successor",
            identifier: "test-successor",
            predecessor: randomRoot()
        });

        expect(successor.identifier).to.equal("test-successor");
        expect(successor.predecessor.type).to.equal("IntegrationTest.Root");
    });

    it("should get the device identity", async () => {
        const device = await j.local();

        expect(device.type).to.equal("Jinaga.Device");
    });

    it("should get device information", async () => {
        const device = await j.local();

        await j.fact({
            type: "Configuration",
            from: device
        });

        await check(async j => {
            const checkDevice = await j.local();
            expect(checkDevice).to.deep.equal(device);

            const configurations = await j.query(checkDevice, j.for(configurationFromDevice));

            expect(configurations).to.deep.equal([
                {
                    type: "Configuration",
                    from: checkDevice
                }
            ]);
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

        expect(user.userFact.type).to.equal("Jinaga.User");
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
            expect(e.message).to.equal("Rejected 1 fact of type IntegrationTest.Unauthorized.");
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

        expect(userNames.length).to.equal(1);
        expect(userNames[0].value).to.equal("Test User");
    });
})

function randomRoot() {
    const num = forge.random.getBytesSync(16);
    const identifier = forge.util.encode64(num);

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
    ensure(name).has("from");
    return Jinaga.match(name.from);
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
        // .type("MyApplication.UserName", Jinaga.for(nameUser))
        ;
}