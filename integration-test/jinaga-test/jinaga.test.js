const { expect } = require("chai");
const { JinagaServer } = require("./jinaga");

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
        const root = await j.fact({
            type: "IntegrationTest.Root",
            identifier: "test-root"
        });

        expect(root.identifier).to.equal("test-root");
    });

    it("should save a fact twice", async () => {
        await j.fact({
            type: "IntegrationTest.Root",
            identifier: "test-root"
        });
        const root = await j.fact({
            type: "IntegrationTest.Root",
            identifier: "test-root"
        });

        expect(root.identifier).to.equal("test-root");
    });

    it("should save a successor fact", async () => {
        const root = await j.fact({
            type: "IntegrationTest.Root",
            identifier: "test-root"
        });

        const successor = await j.fact({
            type: "IntegrationTest.Successor",
            identifier: "test-successor",
            predecessor: root
        });

        expect(successor.identifier).to.equal("test-successor");
        expect(successor.predecessor).to.deep.equal(root);
    });

    it("should save a successor fact twice", async () => {
        const root = await j.fact({
            type: "IntegrationTest.Root",
            identifier: "test-root"
        });

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
            predecessor: {
                type: "IntegrationTest.Root",
                identifier: "test-root"
            }
        });

        expect(successor.identifier).to.equal("test-successor");
        expect(successor.predecessor.identifier).to.equal("test-root");
    });
})