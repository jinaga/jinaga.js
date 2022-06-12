const { parseSpecification } = require("../dist/specification/specification-parser");
const { sqlFromSpecification } = require("../dist/postgres/specification-sql");
const { dehydrateReference } = require("../dist/fact/hydrate");
const { getAllFactTypes, getAllRoles } = require("../dist/specification/specification");
const { emptyFactTypeMap, emptyRoleMap, addFactType, addRole, getFactTypeId } = require("../dist/postgres/maps");
const fs = require("fs");

try {
    var input = fs.readFileSync(0, 'utf-8');
    var specification = parseSpecification(input);
    const factTypeNames = getAllFactTypes(specification);
    const factTypes = factTypeNames.reduce(
        (f, factType, i) => addFactType(f, factType, i + 1),
        emptyFactTypeMap());
    let roleMap = getAllRoles(specification).reduce(
        (r, role, i) => addRole(r, getFactTypeId(factTypes, role.declaringType), role.name, i + 1),
        emptyRoleMap());
    const start = dehydrateReference({ type: 'Jinaga.User', publicKey: '--- PUBLIC KEY ---' });
    const sqlQueries = sqlFromSpecification([start], [], 100, specification, factTypes, roleMap);
    console.log(JSON.stringify(sqlQueries, null, 2));
} catch (e) {
    console.error(e);
}
