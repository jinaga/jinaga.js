const { parseSpecification } = require("../dist/specification/specification-parser");
const { sqlFromSpecification } = require("../dist/postgres/specification-sql");
const { dehydrateReference } = require("../dist/fact/hydrate");
const { getAllFactTypes, getAllRoles } = require("../dist/specification/specification");
const { emptyFactTypeMap, emptyRoleMap, addFactType, addRole, getFactTypeId } = require("../dist/postgres/maps");
const { PostgresStore } = require("../dist/postgres/postgres-store")
const fs = require("fs");

async function run() {
    try {
        var postgresStore = new PostgresStore("postgresql://dev:devpw@localhost:5432/myapplication");
        try {
            var input = fs.readFileSync(0, 'utf-8');
            var specification = parseSpecification(input);
        
            const start = dehydrateReference({ type: 'MyApplication.Domain', identifier: 'myapplication' });
            const results = await postgresStore.queryFromSpecification([start], "", 3, specification);
            console.log(JSON.stringify(results, null, 2));
        }
        finally {
            postgresStore.close();
        }
    } catch (e) {
        console.error(e);
    }
}

run();