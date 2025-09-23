"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
describe("GraphDeserializer", () => {
    it("should read an empty graph", () => __awaiter(void 0, void 0, void 0, function* () {
        const input = "";
        const readLine = createReadLine(input);
        const deserializer = new _src_1.GraphDeserializer(readLine);
        const envelopes = yield readAll(deserializer);
        expect(envelopes).toEqual([]);
    }));
    it("should read a graph with one fact without signatures", () => __awaiter(void 0, void 0, void 0, function* () {
        const input = "\"MyApp.Root\"\n{}\n{\"identifier\":\"root\"}\n\n";
        const readLine = createReadLine(input);
        const deserializer = new _src_1.GraphDeserializer(readLine);
        const envelopes = yield readAll(deserializer);
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
    }));
    it("should read a graph with two facts without signatures", () => __awaiter(void 0, void 0, void 0, function* () {
        const input = "\"MyApp.Root\"\n{}\n{}\n\n\"MyApp.Child\"\n{\"root\":0}\n{}\n\n";
        const readLine = createReadLine(input);
        const deserializer = new _src_1.GraphDeserializer(readLine);
        const envelopes = yield readAll(deserializer);
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
    }));
    it("should read a graph with two facts with signatures", () => __awaiter(void 0, void 0, void 0, function* () {
        const input = "PK0\n\"public\"\n\n" +
            "\"MyApp.Root\"\n{}\n{}\nPK0\n\"signature\"\n\n" +
            "PK1\n\"public2\"\n\n" +
            "\"MyApp.Child\"\n{\"root\":0}\n{}\nPK0\n\"signature1\"\nPK1\n\"signature2\"\n\n";
        const readLine = createReadLine(input);
        const deserializer = new _src_1.GraphDeserializer(readLine);
        const envelopes = yield readAll(deserializer);
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
    }));
});
function createReadLine(input) {
    const lines = input.split("\n");
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }
    return () => __awaiter(this, void 0, void 0, function* () {
        const line = lines.shift();
        return line !== undefined ? line : null;
    });
}
function readAll(deserializer) {
    return __awaiter(this, void 0, void 0, function* () {
        const envelopes = [];
        yield deserializer.read((batch) => __awaiter(this, void 0, void 0, function* () {
            envelopes.push(...batch);
        }));
        return envelopes;
    });
}
//# sourceMappingURL=deserializerSpec.js.map