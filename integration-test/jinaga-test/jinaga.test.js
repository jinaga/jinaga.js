const { JinagaServer } = require("./jinaga");

describe("Jinaga", () => {
    it("should save a fact", async () => {
        const { j } = JinagaServer.create({

        });

        const root = await j.fact({
            type: "IntegrationTest.Root",
            identifier: "test-root"
        });

        expect(root.identifier).toBe("test-root");
    })
})