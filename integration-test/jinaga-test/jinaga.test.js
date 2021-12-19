const { expect } = require("chai");
const { JinagaServer } = require("./jinaga");

describe("Jinaga", () => {
    it("should save a fact", async () => {
        const { j } = JinagaServer.create({
            pgKeystore: "postgresql://dev:devpw@db:5432/integrationtest",
            pgStore:    "postgresql://dev:devpw@db:5432/integrationtest"
        });

        const root = await j.fact({
            type: "IntegrationTest.Root",
            identifier: "test-root"
        });

        expect(root.identifier).to.equal("test-root");
    })
})