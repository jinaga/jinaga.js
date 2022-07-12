const { parseSpecification } = require("../dist/specification/specification-parser");
const { sqlFromSpecification } = require("../dist/postgres/specification-sql");
const { dehydrateReference } = require("../dist/fact/hydrate");
const { getAllFactTypes, getAllRoles } = require("../dist/specification/specification");
const { emptyFactTypeMap, emptyRoleMap, addFactType, addRole, getFactTypeId } = require("../dist/postgres/maps");
const { PostgresStore } = require("../dist/postgres/postgres-store")
const fs = require("fs");

var user = {"publicKey":"-----BEGIN RSA PUBLIC KEY-----\nMIGJAoGBAIBsKomutukULWw2zoTW2ECMrM8VmD2xvfpl3R4qh1whzuXV+A4EfRKMb/UAjEfw\n5nBmWvcObGyYUgygKrlNeOhf3MnDj706rej6ln9cKGL++ZNsJgJsogaAtmkPihWVGi908fdP\nLQrWTF5be0b/ZP258Zs3CTpcRTpTvhzS5TC1AgMBAAE=\n-----END RSA PUBLIC KEY-----\n","type":"Jinaga.User"};
var company = {"name":"Improving","type":"ImprovingU.Company","from":user};
var semester = {"type":"ImprovingU.Semester","name":"Fall 2021","company":company};

async function run() {
    try {
        var postgresStore = new PostgresStore("postgresql://dev:devpw@localhost:5432/improvingu");
        try {
            var input = fs.readFileSync(0, 'utf-8');
            var specification = parseSpecification(input);

            // Select starting facts that match the inputs
            var facts = specification.given.map(input => {
                if (input.type === "Jinaga.User") {
                    return user;
                }
                if (input.type === "ImprovingU.Company") {
                    return company;
                }
                if (input.type === "ImprovingU.Semester") {
                    return semester;
                }
                throw new Error("Unknown input type: " + input.type);
            });
        
            const start = facts.map(fact => dehydrateReference(fact));

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