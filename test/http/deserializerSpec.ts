import { FactEnvelope, GraphDeserializer } from "@src";

describe("GraphDeserializer", () => {
    it("should read an empty graph", async () => {
        const input = "";
        const readLine = createReadLine(input);
        const deserializer = new GraphDeserializer(readLine);
        const envelopes = await readAll(deserializer);
        expect(envelopes).toEqual([]);
    });

    it("should read a graph with one fact without signatures", async () => {
        const input = "\"MyApp.Root\"\n{}\n{\"identifier\":\"root\"}\n\n";
        const readLine = createReadLine(input);
        const deserializer = new GraphDeserializer(readLine);
        const envelopes = await readAll(deserializer);
        expect(envelopes).toEqual([{
            fact: {
                type: "MyApp.Root",
                hash: "2nxJF8sJEFIuY70VLJvhOR+9V28FoH98lLaL3cCXGqpDpX/lYz0mjohvHxvjHBgDAleJ5L2Dq4Qa2ybGE5NNww==",
                fields: {
                    identifier: "root"
                },
                predecessors: {}
            },
            signatures: []
        }]);
    });

    it("should read a graph with two facts without signatures", async () => {
        const input = "\"MyApp.Root\"\n{}\n{}\n\n\"MyApp.Child\"\n{\"root\":0}\n{}\n\n";
        const readLine = createReadLine(input);
        const deserializer = new GraphDeserializer(readLine);
        const envelopes = await readAll(deserializer);
        expect(envelopes).toEqual([{
            fact: {
                type: "MyApp.Root",
                hash: "fSS1hK7OGAeSX4ocN3acuFF87jvzCdPN3vLFUtcej0lOAsVV859UIYZLRcHUoMbyd/J31TdVn5QuE7094oqUPg==",
                fields: {},
                predecessors: {}
            },
            signatures: []
        }, {
            fact: {
                type: "MyApp.Child",
                hash: "9m4j5fur76Ofg2PnOxtlufPDKt7DKqqJewylpt0T6HluB5OhyqBaKTtO9SjtkKmI6CxLWmgGdZzdV1Al0YVtRg==",
                fields: {},
                predecessors: {
                    root: {
                        type: "MyApp.Root",
                        hash: "fSS1hK7OGAeSX4ocN3acuFF87jvzCdPN3vLFUtcej0lOAsVV859UIYZLRcHUoMbyd/J31TdVn5QuE7094oqUPg=="
                    }
                }
            },
            signatures: []
        }]);
    });

    it("should read a graph with two facts with signatures", async () => {
        const input =
            "PK0\n\"public\"\n\n" +
            "\"MyApp.Root\"\n{}\n{}\nPK0\n\"signature\"\n\n" +
            "PK1\n\"public2\"\n\n" +
            "\"MyApp.Child\"\n{\"root\":0}\n{}\nPK0\n\"signature1\"\nPK1\n\"signature2\"\n\n";
        const readLine = createReadLine(input);
        const deserializer = new GraphDeserializer(readLine);
        const envelopes = await readAll(deserializer);
        expect(envelopes).toEqual([{
            fact: {
                type: "MyApp.Root",
                hash: "fSS1hK7OGAeSX4ocN3acuFF87jvzCdPN3vLFUtcej0lOAsVV859UIYZLRcHUoMbyd/J31TdVn5QuE7094oqUPg==",
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
                hash: "9m4j5fur76Ofg2PnOxtlufPDKt7DKqqJewylpt0T6HluB5OhyqBaKTtO9SjtkKmI6CxLWmgGdZzdV1Al0YVtRg==",
                fields: {},
                predecessors: {
                    root: {
                        type: "MyApp.Root",
                        hash: "fSS1hK7OGAeSX4ocN3acuFF87jvzCdPN3vLFUtcej0lOAsVV859UIYZLRcHUoMbyd/J31TdVn5QuE7094oqUPg=="
                    }
                }
            },
            signatures: [
              {
                "publicKey": "public",
                "signature": "signature1",
              }, {
                "publicKey": "public2",
                "signature": "signature2",
              },
            ],
        }]);
    });
});

function createReadLine(input: string) {
    const lines = input.split("\n");
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }
    return async () => {
        const line = lines.shift();
        return line !== undefined ? line : null;
    };
}

async function readAll(deserializer: GraphDeserializer) {
    const envelopes: FactEnvelope[] = [];
    await deserializer.read(async (batch) => {
        envelopes.push(...batch);
    });
    return envelopes;
}