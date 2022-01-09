const { expect } = require("chai");
const { Jinaga, JinagaServer } = require("./jinaga");
const forge = require("node-forge");

describe("Jinaga", () => {
    let j;
    let close;

    beforeAll(() => {
        ({ j, close } = JinagaServer.create({
            pgKeystore: "postgresql://dev:devpw@db:5432/integrationtest",
            pgStore:    "postgresql://dev:devpw@db:5432/integrationtest"
        }));
    });

    afterAll(async () => {
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