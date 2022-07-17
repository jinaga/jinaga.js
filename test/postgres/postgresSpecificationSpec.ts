import { dehydrateReference } from "../../src/fact/hydrate";
import { addFactType, addRole, emptyFactTypeMap, emptyRoleMap, getFactTypeId, getRoleId } from "../../src/postgres/maps";
import { SpecificationSqlQuery } from "../../src/postgres/query-description";
import { sqlFromSpecification } from "../../src/postgres/specification-sql";
import { getAllFactTypes, getAllRoles } from "../../src/specification/specification";
import { parseSpecification } from "../../src/specification/specification-parser";
import { FactBookmark } from "../../src/storage";

const root = dehydrateReference({ type: 'Root' });
const rootHash = root.hash;
const user = dehydrateReference({ type: "Jinaga.User", publicKey: "PUBLIC KEY"});
const userHash = user.hash;

function sqlFor(descriptiveString: string, bookmarks: FactBookmark[] = []) {
    const specification = parseSpecification(descriptiveString);
    const factTypeNames = getAllFactTypes(specification);

    // Build a fact type map containing all fact types in the specification.
    // Filter out fact types named "Unknown".
    const factTypes = factTypeNames.filter(t => t !== 'Unknown').reduce(
        (f, factType, i) => addFactType(f, factType, i + 1),
        emptyFactTypeMap());

    // Build a role map containing all roles in the specification.
    // Filter out the roles named "unknown", and those of unknown fact types.
    let roleMap = getAllRoles(specification).filter(r => r.name !== 'unknown').reduce(
        (r, role, i) => {
            const factTypeId = getFactTypeId(factTypes, role.definingFactType);
            if (!factTypeId) {
                return r;
            }
            return addRole(r, factTypeId, role.name, i + 1);
        },
        emptyRoleMap());
    const start = specification.given.map(input => {
        if (input.type === 'Root') {
            return root;
        }
        if (input.type === 'Jinaga.User') {
            return user;
        }
        throw new Error(`Unknown input type ${input.type}`);
    });
    const sqlQueries: SpecificationSqlQuery[] = sqlFromSpecification(start, bookmarks, 100, specification, factTypes, roleMap);
    return { sqlQueries, factTypes, roleMap };
}

function roleParameter(roleMap: Map<number, Map<string, number>>, factTypes: Map<string, number>, factTypeName: string, roleName: string): number {
    const factTypeId = getFactTypeId(factTypes, factTypeName);
    if (!factTypeId) {
        throw new Error(`Unknown fact type ${factTypeName}`);
    }
    const roleId = getRoleId(roleMap, factTypeId, roleName);
    if (!roleId) {
        throw new Error(`Unknown role ${roleName} in fact type ${factTypeName}`);
    }
    return roleId;
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
            'SELECT f2.hash as hash2, ' +
            'sort(array[f2.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND sort(array[f2.fact_id], \'desc\') > $4 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $5'
        );
        expect(query.parameters).toEqual([
            getFactTypeId(factTypes, 'Root'),
            rootHash,
            roleParameter(roleMap, factTypes, 'IntegrationTest.Successor', 'predecessor'),
            [],
            100
        ]);
        expect(query.labels).toEqual([
            {
                name: 'successor',
                type: 'IntegrationTest.Successor',
                index: 2
            }
        ]);
    });

    it("should generate a join to successor and then predecessor", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (predecessor: Root) {
                successor: IntegrationTest.Successor [
                    successor->predecessor:Root = predecessor
                ]
                other: IntegrationTest.OtherPredecessor [
                    other = successor->other:IntegrationTest.OtherPredecessor
                ]
            }`);

            expect(sqlQueries.length).toEqual(1)
            expect(sqlQueries[0].sql).toEqual(
                'SELECT f2.hash as hash2, ' +
                'f3.hash as hash3, ' +
                'sort(array[f2.fact_id, f3.fact_id], \'desc\') as bookmark ' +
                'FROM public.fact f1 ' +
                'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
                'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
                'JOIN public.edge e2 ON e2.successor_fact_id = f2.fact_id AND e2.role_id = $4 ' +
                'JOIN public.fact f3 ON f3.fact_id = e2.predecessor_fact_id ' +
                'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
                'AND sort(array[f2.fact_id, f3.fact_id], \'desc\') > $5 ' +
                'ORDER BY bookmark ASC ' +
                'LIMIT $6'
            );
            expect(sqlQueries[0].parameters).toEqual([
                getFactTypeId(factTypes, "Root"),
                rootHash,
                roleParameter(roleMap, factTypes, "IntegrationTest.Successor", "predecessor"),
                roleParameter(roleMap, factTypes, "IntegrationTest.Successor", "other"),
                [],
                100
            ]);
            expect(sqlQueries[0].labels).toEqual([
                {
                    name: "successor",
                    type: "IntegrationTest.Successor",
                    index: 2
                },
                {
                    name: "other",
                    type: "IntegrationTest.OtherPredecessor",
                    index: 3
                }
            ]);
    });

    it("should generate positive existential conditions", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                    E {
                        assignment: MyApplication.Assignment [
                            assignment->project: MyApplication.Project = project
                        ]
                    }
                ]
            }
        `);

        expect(sqlQueries.length).toEqual(1);
        expect(sqlQueries[0].sql).toEqual(
            'SELECT f2.hash as hash2, ' +
            'f3.hash as hash3, ' +
            'sort(array[f2.fact_id, f3.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'JOIN public.edge e2 ON e2.predecessor_fact_id = f2.fact_id AND e2.role_id = $4 ' +
            'JOIN public.fact f3 ON f3.fact_id = e2.successor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND sort(array[f2.fact_id, f3.fact_id], \'desc\') > $5 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $6'
        );
        expect(sqlQueries[0].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            roleParameter(roleMap, factTypes, "MyApplication.Assignment", "project"),
            [],
            100
        ]);
        expect(sqlQueries[0].labels).toEqual([
            {
                name: "project",
                type: "MyApplication.Project",
                index: 2
            },
            {
                name: "assignment",
                type: "MyApplication.Assignment",
                index: 3
            }
        ]);
    });

    it("should generate negative existential conditions", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                    !E {
                        deleted: MyApplication.Project.Deleted [
                            deleted->project: MyApplication.Project = project
                        ]
                    }
                ]
            }
        `);

        expect(sqlQueries.length).toEqual(2);
        expect(sqlQueries[0].sql).toEqual(
            'SELECT f2.hash as hash2, ' +
            'f3.hash as hash3, ' +
            'sort(array[f2.fact_id, f3.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'JOIN public.edge e2 ON e2.predecessor_fact_id = f2.fact_id AND e2.role_id = $4 ' +
            'JOIN public.fact f3 ON f3.fact_id = e2.successor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND sort(array[f2.fact_id, f3.fact_id], \'desc\') > $5 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $6'
        );
        expect(sqlQueries[0].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            roleParameter(roleMap, factTypes, "MyApplication.Project.Deleted", "project"),
            [],
            100
        ]);
        expect(sqlQueries[0].labels).toEqual([
            {
                name: "project",
                type: "MyApplication.Project",
                index: 2
            },
            {
                name: "deleted",
                type: "MyApplication.Project.Deleted",
                index: 3
            }
        ]);

        expect(sqlQueries[1].sql).toEqual(
            'SELECT f2.hash as hash2, ' +
            'sort(array[f2.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND NOT EXISTS (' +
                'SELECT 1 ' +
                'FROM public.edge e2 ' +
                'JOIN public.fact f3 ON f3.fact_id = e2.successor_fact_id ' +
                'WHERE e2.predecessor_fact_id = f2.fact_id AND e2.role_id = $4' +
            ') ' +
            'AND sort(array[f2.fact_id], \'desc\') > $5 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $6'
        );
        expect(sqlQueries[1].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            roleParameter(roleMap, factTypes, "MyApplication.Project.Deleted", "project"),
            [],
            100
        ]);
        expect(sqlQueries[1].labels).toEqual([
            {
                name: "project",
                type: "MyApplication.Project",
                index: 2
            }
        ]);
    });

    it("should accept multiple givens", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (root: Root, user: Jinaga.User) {
                project: MyApplication.Project [
                    project->root: Root = root
                ]
                assignment: MyApplication.Assignment [
                    assignment->project: MyApplication.Project = project
                    assignment->user: Jinaga.User = user
                ]
            }
        `);

        expect(sqlQueries.length).toEqual(1);
        expect(sqlQueries[0].sql).toEqual(
            'SELECT f3.hash as hash3, ' +
            'f4.hash as hash4, ' +
            'sort(array[f3.fact_id, f4.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f3 ON f3.fact_id = e1.successor_fact_id ' +
            'JOIN public.edge e2 ON e2.predecessor_fact_id = f3.fact_id AND e2.role_id = $4 ' +
            'JOIN public.fact f4 ON f4.fact_id = e2.successor_fact_id ' +
            'JOIN public.edge e3 ON e3.successor_fact_id = f4.fact_id AND e3.role_id = $7 ' +
            'JOIN public.fact f2 ON f2.fact_id = e3.predecessor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND f2.fact_type_id = $5 AND f2.hash = $6 ' +
            'AND sort(array[f3.fact_id, f4.fact_id], \'desc\') > $8 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $9'
        );
        expect(sqlQueries[0].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            roleParameter(roleMap, factTypes, "MyApplication.Assignment", "project"),
            getFactTypeId(factTypes, "Jinaga.User"),
            userHash,
            roleParameter(roleMap, factTypes, "MyApplication.Assignment", "user"),
            [],
            100
        ]);
        expect(sqlQueries[0].labels).toEqual([
            {
                name: "project",
                type: "MyApplication.Project",
                index: 3
            },
            {
                name: "assignment",
                type: "MyApplication.Assignment",
                index: 4
            }
        ]);
    });

    it("should accept givens in any order", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (user: Jinaga.User, root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                ]
                assignment: MyApplication.Assignment [
                    assignment->project: MyApplication.Project = project
                    assignment->user: Jinaga.User = user
                ]
            }
        `);

        expect(sqlQueries.length).toEqual(1);
        expect(sqlQueries[0].sql).toEqual(
            'SELECT f3.hash as hash3, ' +
            'f4.hash as hash4, ' +
            'sort(array[f3.fact_id, f4.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f2 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f2.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f3 ON f3.fact_id = e1.successor_fact_id ' +
            'JOIN public.edge e2 ON e2.predecessor_fact_id = f3.fact_id AND e2.role_id = $4 ' +
            'JOIN public.fact f4 ON f4.fact_id = e2.successor_fact_id ' +
            'JOIN public.edge e3 ON e3.successor_fact_id = f4.fact_id AND e3.role_id = $7 ' +
            'JOIN public.fact f1 ON f1.fact_id = e3.predecessor_fact_id ' +
            'WHERE f1.fact_type_id = $5 AND f1.hash = $6 ' +
            'AND f2.fact_type_id = $1 AND f2.hash = $2 ' +
            'AND sort(array[f3.fact_id, f4.fact_id], \'desc\') > $8 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $9'
        );
        expect(sqlQueries[0].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            roleParameter(roleMap, factTypes, "MyApplication.Assignment", "project"),
            getFactTypeId(factTypes, "Jinaga.User"),
            userHash,
            roleParameter(roleMap, factTypes, "MyApplication.Assignment", "user"),
            [],
            100
        ]);
        expect(sqlQueries[0].labels).toEqual([
            {
                name: "project",
                type: "MyApplication.Project",
                index: 3
            },
            {
                name: "assignment",
                type: "MyApplication.Assignment",
                index: 4
            }
        ]);
    });

    it("should accept a projection", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                ]
            } => {
                names = {
                    name: MyApplication.Project.Name [
                        name->project: MyApplication.Project = project
                    ]
                }
            }`);

        expect(sqlQueries.length).toEqual(2);
        expect(sqlQueries[0].sql).toEqual(
            'SELECT f2.hash as hash2, ' +
            'sort(array[f2.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND sort(array[f2.fact_id], \'desc\') > $4 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $5'
        );
        expect(sqlQueries[0].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            [],
            100
        ]);
        expect(sqlQueries[0].labels).toEqual([
            {
                name: "project",
                type: "MyApplication.Project",
                index: 2
            }
        ]);
        expect(sqlQueries[1].sql).toEqual(
            'SELECT f2.hash as hash2, f3.hash as hash3, ' +
            'sort(array[f2.fact_id, f3.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'JOIN public.edge e2 ON e2.predecessor_fact_id = f2.fact_id AND e2.role_id = $4 ' +
            'JOIN public.fact f3 ON f3.fact_id = e2.successor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND sort(array[f2.fact_id, f3.fact_id], \'desc\') > $5 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $6'
        );
        expect(sqlQueries[1].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            roleParameter(roleMap, factTypes, "MyApplication.Project.Name", "project"),
            [],
            100
        ]);
        expect(sqlQueries[1].labels).toEqual([
            {
                name: "project",
                type: "MyApplication.Project",
                index: 2
            },
            {
                name: "names.name",
                type: "MyApplication.Project.Name",
                index: 3
            }
        ]);
    });

    it("should apply the bookmark for each feed", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                ]
            } => {
                names = {
                    name: MyApplication.Project.Name [
                        name->project: MyApplication.Project = project
                        !E {
                            next: MyApplication.Project.Name [
                                next->prior: MyApplication.Project.Name = name
                            ]
                        }
                    ]
                }
            }`, [
                {
                    labels: [ "project" ],
                    bookmark: "123"
                },
                {
                    labels: [ "project", "names.name", "names.next" ],
                    bookmark: "456.345.234"
                },
                {
                    labels: [ "project", "names.name" ],
                    bookmark: "789.678"
                }
            ]);

        expect(sqlQueries.length).toEqual(3);
        expect(sqlQueries[0].sql).toEqual(
            'SELECT f2.hash as hash2, ' +
            'sort(array[f2.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND sort(array[f2.fact_id], \'desc\') > $4 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $5'
        );
        expect(sqlQueries[0].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            [ 123 ],
            100
        ]);
        expect(sqlQueries[0].labels).toEqual([
            {
                name: "project",
                type: "MyApplication.Project",
                index: 2
            }
        ]);
    });

    it("should accept overconstrained specification", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                    project->root2: Root = root
                ]
            }`);

        expect(sqlQueries.length).toEqual(1);
        expect(sqlQueries[0].sql).toEqual(
            'SELECT f2.hash as hash2, ' +
            'sort(array[f2.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'JOIN public.edge e2 ON e2.predecessor_fact_id = f1.fact_id AND e2.successor_fact_id = f2.fact_id AND e2.role_id = $4 ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND sort(array[f2.fact_id], \'desc\') > $5 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $6'
        );
        expect(sqlQueries[0].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root2"),
            [],
            100
        ]);
        expect(sqlQueries[0].labels).toEqual([
            {
                name: "project",
                type: "MyApplication.Project",
                index: 2
            }
        ]);
    });

    it("should accept overconstrained existential query", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                ]
            } => {
                names = {
                    name: MyApplication.Project.Name [
                        name->project: MyApplication.Project = project
                        !E {
                            next: MyApplication.Project.Name [
                                next->prior: MyApplication.Project.Name = name
                                next->project: MyApplication.Project = project
                            ]
                        }
                    ]
                }
            }`);
        expect(sqlQueries.length).toEqual(3);
        expect(sqlQueries[2].sql).toEqual(
            'SELECT f2.hash as hash2, f3.hash as hash3, ' +
            'sort(array[f2.fact_id, f3.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'JOIN public.edge e2 ON e2.predecessor_fact_id = f2.fact_id AND e2.role_id = $4 ' +
            'JOIN public.fact f3 ON f3.fact_id = e2.successor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND NOT EXISTS (' +
                'SELECT 1 ' +
                'FROM public.edge e3 ' +
                'JOIN public.fact f4 ON f4.fact_id = e3.successor_fact_id ' +
                'JOIN public.edge e4 ON e4.predecessor_fact_id = f2.fact_id AND e4.successor_fact_id = f4.fact_id AND e4.role_id = $6 ' +
                'WHERE e3.predecessor_fact_id = f3.fact_id AND e3.role_id = $5' +
            ') ' +
            'AND sort(array[f2.fact_id, f3.fact_id], \'desc\') > $7 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $8'
        );
        expect(sqlQueries[1].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            roleParameter(roleMap, factTypes, "MyApplication.Project.Name", "project"),
            roleParameter(roleMap, factTypes, "MyApplication.Project.Name", "prior"),
            roleParameter(roleMap, factTypes, "MyApplication.Project.Name", "project"),
            [],
            100
        ]);
    });

    it("skips unknown types in matches", () => {
        const { sqlQueries } = sqlFor(`
            (root: Root) {
                successor: Unknown [
                    successor->root: Root = root
                ]
            }`);

        expect(sqlQueries.length).toEqual(0);
    });

    it("skips unknown types on left in paths", () => {
        const { sqlQueries } = sqlFor(`
            (root: Root) {
                successor: MyApplication.Project [
                    successor->intermediate: Unknown->root: Root = root
                ]
            }`);

        expect(sqlQueries.length).toEqual(0);
    });

    it("skips unknown types on right in paths", () => {
        const { sqlQueries } = sqlFor(`
            (root: Root) {
                successor: MyApplication.Successor [
                    successor = root->intermediate: Unknown->root: Root
                ]
            }`);

        expect(sqlQueries.length).toEqual(0);
    });

    it("skips unknown roles on left in paths", () => {
        const { sqlQueries } = sqlFor(`
            (root: Root) {
                successor: MyApplication.Project [
                    successor->unknown: Root = root
                ]
            }`);

        expect(sqlQueries.length).toEqual(0);
    });

    it("skips unknown roles on right in paths", () => {
        const { sqlQueries } = sqlFor(`
            (root: Root) {
                successor: MyApplication.Successor [
                    successor = root->unknown: Intermediate->root: Root
                ]
            }`);

        expect(sqlQueries.length).toEqual(0);
    });

    it("skips entire query when second path contains unknown role", () => {
        const { sqlQueries } = sqlFor(`
            (root: Root) {
                successor: MyApplication.Project [
                    successor->root: Root = root
                    successor->unknown: Root = root
                ]
            }`);

        expect(sqlQueries.length).toEqual(0);
    });

    it("skips entire query when first path contains unknown role", () => {
        const { sqlQueries } = sqlFor(`
            (root: Root) {
                successor: MyApplication.Project [
                    successor->unknown: Root = root
                    successor->root: Root = root
                ]
            }`);

        expect(sqlQueries.length).toEqual(0);
    });

    it("skips existential conditions that are unsatisfiable", () => {
        const { sqlQueries, factTypes, roleMap } = sqlFor(`
            (root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                    !E {
                        delete: Unknown [
                            delete->project: MyApplication.Project = project
                        ]
                    }
                ]
            }`);

        expect(sqlQueries.length).toEqual(1);

        expect(sqlQueries[0].sql).toEqual(
            'SELECT f2.hash as hash2, ' +
            'sort(array[f2.fact_id], \'desc\') as bookmark ' +
            'FROM public.fact f1 ' +
            'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
            'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
            'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
            'AND sort(array[f2.fact_id], \'desc\') > $4 ' +
            'ORDER BY bookmark ASC ' +
            'LIMIT $5'
        );
        expect(sqlQueries[0].parameters).toEqual([
            getFactTypeId(factTypes, "Root"),
            rootHash,
            roleParameter(roleMap, factTypes, "MyApplication.Project", "root"),
            [],
            100
        ]);
        expect(sqlQueries[0].labels).toEqual([
            {
                name: "project",
                type: "MyApplication.Project",
                index: 2
            }
        ])
    });
});
