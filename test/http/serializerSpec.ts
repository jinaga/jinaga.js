import { GraphSerializer } from "@src";

describe("GraphSerializer", () => {
    it("should write an empty graph", () => {
        let output = "";
        const serializer = new GraphSerializer(chunk => {
            output += chunk;
        });

        serializer.serialize([]);

        expect(output).toBe("");
    });

    it("should write a graph with one fact without signatures", () => {
        let output = "";
        const serializer = new GraphSerializer(chunk => {
            output += chunk;
        });

        serializer.serialize([{
            fact: {
                type: "MyApp.Root",
                hash: "roothash",
                fields: {
                    identifier: "root"
                },
                predecessors: {}
            },
            signatures: []
        }]);

        expect(output).toBe("\"MyApp.Root\"\n{}\n{\"identifier\":\"root\"}\n\n");
    });

    it("should write a graph with two facts without signatures", () => {
        let output = "";
        const serializer = new GraphSerializer(chunk => {
            output += chunk;
        });

        serializer.serialize([{
            fact: {
                type: "MyApp.Root",
                hash: "roothash",
                fields: {},
                predecessors: {}
            },
            signatures: []
        }, {
            fact: {
                type: "MyApp.Child",
                hash: "childhash",
                fields: {},
                predecessors: {
                    root: {
                        type: "MyApp.Root",
                        hash: "roothash"
                    }
                }
            },
            signatures: []
        }]);

        expect(output).toBe("\"MyApp.Root\"\n{}\n{}\n\n\"MyApp.Child\"\n{\"root\":0}\n{}\n\n");
    });

    it("should not repeat a fact", () => {
        let output = "";
        const serializer = new GraphSerializer(chunk => {
            output += chunk;
        });

        serializer.serialize([{
            fact: {
                type: "MyApp.Root",
                hash: "roothash",
                fields: {},
                predecessors: {}
            },
            signatures: []
        }, {
            fact: {
                type: "MyApp.Root",
                hash: "roothash",
                fields: {},
                predecessors: {}
            },
            signatures: []
        }]);

        expect(output).toBe("\"MyApp.Root\"\n{}\n{}\n\n");
    });

    it("should write a graph with two facts with signatures", () => {
        let output = "";
        const serializer = new GraphSerializer(chunk => {
            output += chunk;
        });

        serializer.serialize([{
            fact: {
                type: "MyApp.Root",
                hash: "roothash",
                fields: {},
                predecessors: {}
            },
            signatures: [{
                publicKey: "public",
                signature: "signature"
            }]
        }, {
            fact: {
                type: "MyApp.Child",
                hash: "childhash",
                fields: {},
                predecessors: {
                    root: {
                        type: "MyApp.Root",
                        hash: "roothash"
                    }
                }
            },
            signatures: [{
                publicKey: "public",
                signature: "signature1"
            }, {
                publicKey: "public2",
                signature: "signature2"
            }]
        }]);

        expect(output).toBe(
            "PK0\n\"public\"\n\n" +
            "\"MyApp.Root\"\n{}\n{}\nPK0\n\"signature\"\n\n" +
            "PK1\n\"public2\"\n\n" +
            "\"MyApp.Child\"\n{\"root\":0}\n{}\nPK0\n\"signature1\"\nPK1\n\"signature2\"\n\n"
        );
    });
});