const { expect } = require("chai");
const { JinagaServer } = require("./jinaga");

describe("Jinaga", () => {
    it("should save a fact", async () => {
        const { j } = JinagaServer.create({
            pgKeystore: "postgresql://dev:devpw@localhost:5432/integrationtest",
            pgStore:    "postgresql://dev:devpw@localhost:5432/integrationtest"
        });

        const root = await j.fact({
            type: "IntegrationTest.Root",
            identifier: "test-root"
        });

        expect(root.identifier).to.equal("test-root");
    })

    it("should pass", () => {
        expect(1).to.equal(1)
    })

    it("should fail", () => {
        expect(1).to.equal(2)
    })
})