const { SpecificationParser } = require("../dist/specification/specification-parser");
const { dehydrateFact } = require("../dist/fact/hydrate");
const { PostgresStore } = require("../dist/postgres/postgres-store")
const fs = require("fs");

var user = {"publicKey":"-----BEGIN RSA PUBLIC KEY-----\nMIGJAoGBAIBsKomutukULWw2zoTW2ECMrM8VmD2xvfpl3R4qh1whzuXV+A4EfRKMb/UAjEfw\n5nBmWvcObGyYUgygKrlNeOhf3MnDj706rej6ln9cKGL++ZNsJgJsogaAtmkPihWVGi908fdP\nLQrWTF5be0b/ZP258Zs3CTpcRTpTvhzS5TC1AgMBAAE=\n-----END RSA PUBLIC KEY-----\n","type":"Jinaga.User"};

async function run() {
    try {
        var postgresStore = new PostgresStore("postgresql://dev:devpw@localhost:5432/improvingu");
        try {
            var input = fs.readFileSync(0, 'utf-8');
            const parser = new SpecificationParser(input);
            parser.skipWhitespace();
            const userRecord = dehydrateFact(user)[0];
            const knownFacts = {
                me: {
                    fact: userRecord,
                    reference: {
                        type: userRecord.type,
                        hash: userRecord.hash
                    }
                }
            };
            var declaration = parser.parseDeclaration(knownFacts);
            var specification = parser.parseSpecification(input);

            // Select starting facts that match the inputs
            const start = specification.given.map(input => {
                const fact = declaration[input.name];
                if (!fact) {
                    throw new Error(`No fact named ${input.name} was declared`);
                }
                return fact.reference;
            });

            const args = process.argv.slice(2);
            const produceResults = args.includes("--results");
            if (produceResults) {
                const results = await postgresStore.resultsFromSpecification(start, specification);
                console.log(JSON.stringify(results, null, 2));
            }
            else {
                const streams = await postgresStore.streamsFromSpecification(start, [], 3, specification);
                console.log(JSON.stringify(streams, null, 2));
        }
        }
        finally {
            postgresStore.close();
        }
    } catch (e) {
        console.error(e);
    }
}

run();