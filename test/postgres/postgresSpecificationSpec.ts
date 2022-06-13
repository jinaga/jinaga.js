import { dehydrateReference } from "../../src/fact/hydrate";
import { addFactType, addRole, emptyFactTypeMap, emptyRoleMap, getFactTypeId, getRoleId } from "../../src/postgres/maps";
import { getAllFactTypes, getAllRoles, Specification } from "../../src/specification/specification";
import { parseSpecification } from "../../src/specification/specification-parser";
import { SpecificationSqlQuery, sqlFromSpecification } from "../../src/postgres/specification-sql";

const start = dehydrateReference({ type: 'Root' });
const startHash = 'fSS1hK7OGAeSX4ocN3acuFF87jvzCdPN3vLFUtcej0lOAsVV859UIYZLRcHUoMbyd/J31TdVn5QuE7094oqUPg==';

function sqlFor(descriptiveString: string) {
    const specification = parseSpecification(descriptiveString);
    const factTypeNames = getAllFactTypes(specification);
    const factTypes = factTypeNames.filter(t => t !== 'Unknown').reduce(
        (f, factType, i) => addFactType(f, factType, i + 1),
        emptyFactTypeMap());
    let roleMap = getAllRoles(specification).filter(r => r.name !== 'unknown').reduce(
        (r, role, i) => addRole(r, getFactTypeId(factTypes, role.definingFactType), role.name, i + 1),
        emptyRoleMap());
    const sqlQueries: SpecificationSqlQuery[] = sqlFromSpecification([start], [], 100, specification, factTypes, roleMap);
    return { sqlQueries, factTypes, roleMap };
}

describe("Postgres query generator", () => {
    it("should generate a join to successors", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (predecessor: Root) {
                successor: IntegrationTest.Successor [
                    successor->predecessor:Root = predecessor
                ]
            }`);
        expect(sqlQueries.length).toBe(1);
        const query = sqlQueries[0];
        expect(query.sql).toEqual(
            'SELECT f2.hash as hash2 ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2'
        );
        expect(query.parameters[0]).toEqual(getFactTypeId(factTypes, 'Root'));
        expect(query.parameters[1]).toEqual(startHash);
        expect(query.parameters[2]).toEqual(getRoleId(roleMap, getFactTypeId(factTypes, 'IntegrationTest.Successor'), 'predecessor'));
        expect(query.labels).toEqual([
            {
                name: 'successor',
                type: 'IntegrationTest.Successor',
                column: 'hash2'
            }
        ]);
    });
});
