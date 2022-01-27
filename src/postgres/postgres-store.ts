import { PoolClient } from 'pg';
import { canonicalizeFact } from "../fact/hash";
import { Query } from '../query/query';
import { Direction, ExistentialCondition, Join, PropertyCondition, Step } from "../query/steps";
import { FactEnvelope, FactPath, FactRecord, FactReference, factReferenceEquals, PredecessorCollection, Storage } from '../storage';
import { distinct, flatten } from '../util/fn';
import { ConnectionFactory, Row } from './connection';
import { makeEdgeRecords } from './edge-record';
import { hasFact, addFactType, emptyFactTypeMap, FactTypeMap, addRole, emptyRoleMap, hasRole, addFact, emptyFactMap, FactMap, RoleMap, getRoleId, getFactTypeId, getFactId, emptyPublicKeyMap, PublicKeyMap, getPublicKeyId, copyFactTypeMap, mergeFactTypes, copyRoleMap, mergeRoleMaps } from './maps';
import { sqlFromSteps } from './sql';

interface FactTypeResult {
    rows: {
        fact_type_id: number;
        name: string;
    }[];
}

interface RoleResult {
    rows: {
        role_id: number;
        name: string;
        defining_fact_type_id: number;
    }[];
}

interface FactResult {
    rows: {
        fact_id: number;
        fact_type_id: number;
        hash: string;
    }[];
}

interface PublicKeyResult {
    rows: {
        public_key_id: number;
        public_key: string;
    }[];
}

interface AncestorResult {
    rows: {
        fact_type_id: number;
        name: string;
        hash: string;
        data: string;
    }[];
}

function loadFactReference(r: Row): FactReference {
    return {
        type: r.type,
        hash: r.hash
    };
}

function loadFactPath(pathLength: number, factTypeNames: string[], r: Row): FactPath {
    let path: FactPath = [];
    for (let i = 0; i < pathLength; i++) {
        const hash = r['hash' + (i + 2)];
        if (!hash) {
            throw new Error(`Cannot find column 'hash${i + 2}'`);
        }
        path.push({
            type: factTypeNames[i],
            hash: hash
        });
    }
    return path;
}

export class PostgresStore implements Storage {
    private connectionFactory: ConnectionFactory;
    private factTypeMap: FactTypeMap = emptyFactTypeMap();
    private roleMap: RoleMap = emptyRoleMap();

    constructor (postgresUri: string) {
        this.connectionFactory = new ConnectionFactory(postgresUri);
    }

    async close() {
        await this.connectionFactory.close();
    }
    
    async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        if (envelopes.length > 0) {
            const facts = envelopes.map(e => e.fact);
            if (facts.some(f => !f.hash || !f.type)) {
                throw new Error('Attempted to save a fact with no hash or type.');
            }
            return await this.connectionFactory.withTransaction(async (connection) => {
                const factTypes = await storeFactTypes(facts, this.factTypeMap, connection);
                const existingFacts = await findExistingFacts(facts, factTypes, connection);
                const newFacts = facts.filter(f => !hasFact(existingFacts, f.hash, factTypes.get(f.type)));
                if (newFacts.length === 0) {
                    return [];
                }

                const allFacts = await insertFacts(newFacts, factTypes, existingFacts, connection);
                const roles = await storeRoles(newFacts, factTypes, copyRoleMap(this.roleMap), connection);
                await insertEdges(newFacts, allFacts, roles, factTypes, connection);
                await insertAncestors(newFacts, allFacts, factTypes, connection);
                const newEnvelopes = envelopes.filter(envelope => newFacts.some(
                    factReferenceEquals(envelope.fact)));
                if (newEnvelopes.length === 0) {
                    return [];
                }

                const publicKeys = await storePublicKeys(newEnvelopes, connection);
                await insertSignatures(newEnvelopes, allFacts, factTypes, publicKeys, connection);
                this.factTypeMap = mergeFactTypes(this.factTypeMap, factTypes);
                this.roleMap = mergeRoleMaps(this.roleMap, roles);
                return newEnvelopes;
            });
        }
        else {
            return [];
        }
    }

    async query(start: FactReference, query: Query): Promise<FactPath[]> {
        if (query.steps.length === 0) {
            return [[start]];
        }

        try {
            const factTypes = await this.loadFactTypesFromSteps(query.steps, start.type);
            const roleMap = await this.loadRolesFromSteps(query.steps, factTypes, start.type);

            const sqlQuery = sqlFromSteps(start, query.steps, factTypes, roleMap);
            if (!sqlQuery) {
                throw new Error(`Could not generate SQL for query "${query.toDescriptiveString()}" starting at "${start.type}"`);
            }
            if (sqlQuery.empty) {
                return [];
            }
            const { rows } = await this.connectionFactory.with(async (connection) => {
                return await connection.query(sqlQuery.sql, sqlQuery.parameters);
            });
            return rows.map(row => loadFactPath(sqlQuery.pathLength, sqlQuery.factTypeNames, row));
        }
        catch (e) {
            throw new Error(`Could not generate SQL for query "${query.toDescriptiveString()}" starting at "${start.type}": ${e}`);
        }
    }

    private async loadFactTypesFromSteps(steps: Step[], startType: string): Promise<FactTypeMap> {
        const factTypes = this.factTypeMap;
        const unknownFactTypes = [...allFactTypes(steps), startType]
            .filter(factType => !factTypes.has(factType))
            .filter(distinct);
        if (unknownFactTypes.length > 0) {
            const loadedFactTypes = await this.connectionFactory.with(async (connection) => {
                return await loadFactTypes(unknownFactTypes, connection);
            });
            const merged = mergeFactTypes(this.factTypeMap, loadedFactTypes);
            this.factTypeMap = merged;
            return merged;
        }
        return factTypes;
    }

    private async loadRolesFromSteps(steps: Step[], factTypes: FactTypeMap, initialType: string) {
        const roleMap = this.roleMap;
        const unknownRoles = allRoles(steps, factTypes, getFactTypeId(factTypes, initialType))
            .filter(r => !hasRole(roleMap, r.defining_fact_type_id, r.role));
        if (unknownRoles.length > 0) {
            const loadedRoles = await this.connectionFactory.with(async (connection) => {
                return await loadRoles(unknownRoles, roleMap, connection);
            });
            const merged = mergeRoleMaps(this.roleMap, loadedRoles);
            this.roleMap = merged;
            return merged;
        }
        return roleMap;
    }

    async exists(fact: FactReference): Promise<boolean> {
        const factTypes = await this.loadFactTypesFromReferences([fact]);
        const factTypeId = getFactTypeId(factTypes, fact.type);
        if (!factTypeId) {
            return false;
        }
        const sql = 'SELECT COUNT(1) AS count FROM public.fact WHERE fact_type_id=$1 AND hash=$2';
        const parameters = [ factTypeId, fact.hash ];
        const { rows } = await this.connectionFactory.with(async (connection) => {
            return await connection.query(sql, parameters);
        });
        return rows[0].count > 0;
    }

    async load(references: FactReference[]): Promise<FactRecord[]> {
        if (references.length === 0) {
            return [];
        }

        const factTypes = await this.loadFactTypesFromReferences(references);

        const factValues = references.map((f, i) =>
            `(\$${i * 2 + 1}, \$${i * 2 + 2}::integer)`);
        const factParameters = flatten(references, (f) =>
            [f.hash, factTypes.get(f.type)]);
        const sql =
            'SELECT f.fact_type_id, t.name, f.hash, f.data ' +
            'FROM public.fact f ' +
            'JOIN public.fact_type t ' +
            '  ON f.fact_type_id = t.fact_type_id ' +
            'JOIN (VALUES ' + factValues.join(', ') + ') AS v (hash, fact_type_id) ' +
            '  ON v.fact_type_id = f.fact_type_id AND v.hash = f.hash ' +
            'UNION ' +
            'SELECT f2.fact_type_id, t.name, f2.hash, f2.data ' +
            'FROM public.fact f1 ' +
            'JOIN (VALUES ' + factValues.join(', ') + ') AS v (hash, fact_type_id) ' +
            '  ON v.fact_type_id = f1.fact_type_id AND v.hash = f1.hash ' +
            'JOIN public.ancestor a ' +
            '  ON a.fact_id = f1.fact_id ' +
            'JOIN public.fact f2 ' +
            '  ON f2.fact_id = a.ancestor_fact_id ' +
            'JOIN public.fact_type t ' +
            '  ON t.fact_type_id = f2.fact_type_id;';
        const result: AncestorResult = await this.connectionFactory.with(async (connection) => {
            return await connection.query(sql, factParameters);
        })
        const resultFactTypes = result.rows.reduce(
            (factTypes, r) => addFactType(factTypes, r.name, r.fact_type_id),
            emptyFactTypeMap()
        );
        this.factTypeMap = mergeFactTypes(this.factTypeMap, resultFactTypes);
        return result.rows.map((r) => {
            const { fields, predecessors }: { fields: {}, predecessors: PredecessorCollection } = JSON.parse(r.data);
            return <FactRecord>{
                type: r.name,
                hash: r.hash,
                fields,
                predecessors
            }
        });
    }

    private async loadFactTypesFromReferences(references: FactReference[]): Promise<FactTypeMap> {
        const factTypes = this.factTypeMap;
        const newFactTypes = references
            .map(reference => reference.type)
            .filter(type => !factTypes.has(type))
            .filter(distinct);
        if (newFactTypes.length > 0) {
            const loadedFactTypes = await this.connectionFactory.with(async (connection) => {
                return await loadFactTypes(newFactTypes, connection);
            });
            const mergedFactTypes = mergeFactTypes(factTypes, loadedFactTypes);
            this.factTypeMap = mergedFactTypes;
            return mergedFactTypes;
        }
        return factTypes;
    }
}

async function storeFactTypes(facts: FactRecord[], factTypes: FactTypeMap, connection: PoolClient) {
    const newFactTypes = facts
        .map(fact => fact.type)
        .filter(type => !factTypes.has(type))
        .filter(distinct);
    if (newFactTypes.length === 0) {
        return factTypes;
    }

    // Look up existing fact types
    const loadedFactTypes = await loadFactTypes(newFactTypes, connection);
    const remainingNames = newFactTypes.filter(type => !loadedFactTypes.has(type));
    if (remainingNames.length === 0) {
        return mergeFactTypes(loadedFactTypes, factTypes);
    }

    // Insert new fact types
    const values = remainingNames.map((name, index) => `($${index + 1})`);
    const insertSql = 'INSERT INTO public.fact_type (name) VALUES ' + values.join(', ') +
        ' RETURNING fact_type_id, name;';
    const { rows: newRows }: FactTypeResult = await connection.query(insertSql, remainingNames);
    if (newRows.length !== remainingNames.length) {
        throw new Error('Failed to insert all new fact types.');
    }
    const allFactTypes = newRows.reduce(
        (map, row) => addFactType(map, row.name, row.fact_type_id),
        mergeFactTypes(loadedFactTypes, factTypes)
    );
    return allFactTypes;
}

async function loadFactTypes(factTypeNames: string[], connection: PoolClient) {
    const lookUpSql = 'SELECT name, fact_type_id FROM public.fact_type WHERE name=ANY($1);';
    const { rows: existingRows }: FactTypeResult = await connection.query(lookUpSql, [factTypeNames]);
    const factTypeIds = existingRows.reduce(
        (map, row) => addFactType(map, row.name, row.fact_type_id),
        emptyFactTypeMap()
    );
    return factTypeIds;
}

async function storeRoles(facts: FactRecord[], factTypes: FactTypeMap, roleMap: RoleMap, connection: PoolClient) {
    // Find distinct roles
    const roles = flatten(facts, fact => {
        const defining_fact_type_id = factTypes.get(fact.type);
        return Object.keys(fact.predecessors).map(role => ({
            role,
            defining_fact_type_id
        }));
    }).filter((role, index, array) => array.findIndex(r =>
        r.role === role.role &&
        r.defining_fact_type_id === role.defining_fact_type_id
    ) === index);

    if (roles.length > 0) {
        // Look up existing roles
        const roleIds = await loadRoles(roles, roleMap, connection);
        const remainingRoles = roles.filter(role => !hasRole(
            roleIds, role.defining_fact_type_id, role.role));
        if (remainingRoles.length === 0) {
            return roleIds;
        }

        // Insert new roles
        const remainingRoleValues = remainingRoles.map((role, index) =>
            `($${index * 2 + 1}, $${index * 2 + 2}::integer)`);
        const insertSql = 'INSERT INTO public.role (name, defining_fact_type_id) VALUES ' +
            remainingRoleValues.join(', ') +
            ' RETURNING role_id, name, defining_fact_type_id;';
        const remainingRoleParameters = flatten(remainingRoles, (role) => [
            role.role,
            role.defining_fact_type_id
        ]);
        const { rows: newRows }: RoleResult = await connection.query(insertSql, remainingRoleParameters);
        if (newRows.length !== remainingRoles.length) {
            throw new Error('Failed to insert all new roles.');
        }
        const allRoleIds = newRows.reduce(
            (map, row) => addRole(map, row.defining_fact_type_id, row.name, row.role_id),
            roleIds
        );
        return allRoleIds;
    }
}

async function loadRoles(roles: { role: string; defining_fact_type_id: number; }[], roleMap: RoleMap, connection: PoolClient) {
    const roleValues = roles.map((role, index) =>
        `($${index * 2 + 1}, $${index * 2 + 2}::integer)`);
    const roleParameters = flatten(roles, (role) => [
        role.role,
        role.defining_fact_type_id
    ]);

    const lookUpSql = 'SELECT role.name, role.defining_fact_type_id, role.role_id' +
        ' FROM public.role' +
        ' JOIN (VALUES ' + roleValues.join(', ') + ') AS v (name, defining_fact_type_id)' +
        ' ON v.name = role.name AND v.defining_fact_type_id = role.defining_fact_type_id;';
    const { rows }: RoleResult = await connection.query(lookUpSql, roleParameters);
    const roleIds = rows.reduce(
        (map, row) => addRole(map, row.defining_fact_type_id, row.name, row.role_id),
        roleMap
    );
    return roleIds;
}

async function findExistingFacts(facts: FactRecord[], factTypes: FactTypeMap, connection: PoolClient) {
    if (facts.length > 0) {
        const factValues = facts.map((f, i) =>
            `(\$${i * 2 + 1}, \$${i * 2 + 2}::integer)`);
        const factParameters = flatten(facts, (f) =>
            [f.hash, factTypes.get(f.type)]);

        const sql = 'SELECT fact_id, fact.fact_type_id, fact.hash' +
            ' FROM public.fact' +
            ' JOIN (VALUES ' + factValues.join(', ') + ') AS v (hash, fact_type_id)' +
            ' ON v.fact_type_id = fact.fact_type_id AND v.hash = fact.hash;';
        const { rows }: FactResult = await connection.query(sql, factParameters);
        const existingFacts = rows.reduce(
            (map, row) => addFact(map, row.hash, row.fact_type_id, row.fact_id),
            emptyFactMap()
        );
        return existingFacts;
    }
    else {
        return emptyFactMap();
    }
}

async function insertFacts(facts: FactRecord[], factTypes: FactTypeMap, existingFacts: FactMap, connection: PoolClient) {
    if (facts.length > 0) {
        const factValues = facts.map((f, i) =>
            `(\$${i * 3 + 1}, \$${i * 3 + 2}::integer, \$${i * 3 + 3})`);
        const factParameters = flatten(facts, (f) =>
            [f.hash, factTypes.get(f.type), canonicalizeFact(f.fields, f.predecessors)]);

        const sql = 'INSERT INTO public.fact (hash, fact_type_id, data)' +
            ' (SELECT hash, fact_type_id, to_jsonb(data)' +
            '  FROM (VALUES ' + factValues.join(', ') + ') AS v (hash, fact_type_id, data))' +
            ' RETURNING fact_id, fact_type_id, hash;';
        const { rows }: FactResult = await connection.query(sql, factParameters);
        if (rows.length !== facts.length) {
            throw new Error('Failed to insert all new facts.');
        }
        const allFacts = rows.reduce(
            (map, row) => addFact(map, row.hash, row.fact_type_id, row.fact_id),
            existingFacts
        );
        return allFacts;
    }
    else {
        return emptyFactMap();
    }
}

async function insertEdges(facts: FactRecord[], allFacts: FactMap, roles: RoleMap, factTypes: FactTypeMap, connection: PoolClient) {
    const edgeRecords = flatten(facts, makeEdgeRecords);
    if (edgeRecords.length > 0) {
        const edgeValues = edgeRecords.map((e, i) =>
            `(\$${i * 3 + 1}::integer, \$${i * 3 + 2}::integer, \$${i * 3 + 3}::integer)`);
        const edgeParameters = flatten(edgeRecords, (e) => [
            getRoleId(roles, getFactTypeId(factTypes, e.successor_type), e.role),
            getFactId(allFacts, e.successor_hash, getFactTypeId(factTypes, e.successor_type)),
            getFactId(allFacts, e.predecessor_hash, getFactTypeId(factTypes, e.predecessor_type))
        ]);

        await connection.query('INSERT INTO public.edge' +
            ' (role_id, successor_fact_id, predecessor_fact_id)' +
            ' (VALUES ' + edgeValues.join(', ') + ')' +
            ' ON CONFLICT DO NOTHING', edgeParameters);
    }
}

async function insertAncestors(facts: FactRecord[], allFacts: FactMap, factTypes: FactTypeMap, connection: PoolClient) {
    // This function assumes that the facts are listed in topological order.
    // A fact always appears later in the list than its predecessors.
    // Let's check that by keeping track of all predecessors assumed to have been inserted.
    const insertedPredecessors = new Set<number>();
    for (const fact of facts) {
        const factId = getFactId(allFacts, fact.hash, getFactTypeId(factTypes, fact.type));
        if (insertedPredecessors.has(factId)) {
            // We just found a fact after it was supposed to have been inserted.
            throw new Error('Facts are not in topological order.');
        }
        const predecessorIds = makeEdgeRecords(fact).map(e =>
            getFactId(allFacts, e.predecessor_hash, getFactTypeId(factTypes, e.predecessor_type)));
        predecessorIds.forEach(predecessorId => insertedPredecessors.add(predecessorId));
        if (predecessorIds.length > 0) {
            const values = predecessorIds.map((id, index) => `($${index + 2}::integer)`).join(', ');
            const parameters = [factId, ...predecessorIds];
            const sql = 'INSERT INTO public.ancestor' +
                ' (fact_id, ancestor_fact_id)' +
                ' SELECT $1::integer, predecessor_fact_id' +
                ' FROM (VALUES ' + values + ') AS v (predecessor_fact_id)' +
                ' UNION ALL' +
                ' SELECT $1::integer, ancestor_fact_id' +
                ' FROM (VALUES ' + values + ') AS v (predecessor_fact_id)' +
                ' JOIN public.ancestor' +
                '  ON ancestor.fact_id = predecessor_fact_id' +
                ' ON CONFLICT DO NOTHING;';
            await connection.query(sql, parameters);
        }
    }
}

async function storePublicKeys(envelopes: FactEnvelope[], connection: PoolClient) {
    // Look up existing fact types
    const publicKeys = flatten(envelopes, e => e.signatures.map(s => s.publicKey))
        .filter(distinct);
    const lookUpSql = 'SELECT public_key, public_key_id FROM public.public_key WHERE public_key=ANY($1);';
    const { rows: existingRows }: PublicKeyResult = await connection.query(lookUpSql, [publicKeys]);
    const publicKeyIds = existingRows.reduce(
        (map, row) => addFactType(map, row.public_key, row.public_key_id),
        emptyPublicKeyMap()
    );
    const remainingPublicKeys = publicKeys.filter(pk => !publicKeyIds.has(pk));
    if (remainingPublicKeys.length === 0) {
        return publicKeyIds;
    }

    // Insert new fact types
    const values = remainingPublicKeys.map((name, index) => `($${index + 1})`);
    const insertSql = 'INSERT INTO public.public_key (public_key) VALUES ' + values.join(', ') +
        ' RETURNING public_key, public_key_id;';
    const { rows: newRows }: PublicKeyResult = await connection.query(insertSql, remainingPublicKeys);
    if (newRows.length !== remainingPublicKeys.length) {
        throw new Error('Failed to insert all new public keys.');
    }
    const allPublicKeyIds = newRows.reduce(
        (map, row) => addFactType(map, row.public_key, row.public_key_id),
        publicKeyIds
    );
    return allPublicKeyIds;
}

async function insertSignatures(envelopes: FactEnvelope[], allFacts: FactMap, factTypes: FactTypeMap, publicKey: PublicKeyMap, connection: PoolClient) {
    const signatureRecords = flatten(envelopes, envelope => envelope.signatures.map(signature => ({
        factId: getFactId(allFacts, envelope.fact.hash, getFactTypeId(factTypes, envelope.fact.type)),
        publicKeyId: getPublicKeyId(publicKey, signature.publicKey),
        signature: signature.signature
    })));
    if (signatureRecords.length > 0) {
        const signatureValues = signatureRecords.map((s, i) =>
            `($${i * 3 + 1}::integer, $${i * 3 + 2}::integer, $${i * 3 + 3})`);
        const signatureParameters = flatten(signatureRecords, s =>
            [s.factId, s.publicKeyId, s.signature]);

        await connection.query(`INSERT INTO public.signature
            (fact_id, public_key_id, signature) 
            (SELECT fact_id, public_key_id, signature 
            FROM (VALUES ${signatureValues.join(', ')}) AS v(fact_id, public_key_id, signature) 
            ON CONFLICT DO NOTHING`, signatureParameters);
    }
}

function allFactTypes(steps: Step[]): string[] {
    const factTypes = steps
        .filter(step => step instanceof PropertyCondition && step.name === 'type')
        .map(step => (step as PropertyCondition).value);
    const childFactTypes = steps
        .filter(step => step instanceof ExistentialCondition)
        .flatMap(step => allFactTypes((step as ExistentialCondition).steps));
    return [...factTypes, ...childFactTypes].filter(distinct);
}

function allRoles(steps: Step[], factTypes: FactTypeMap, initialTypeId: number) {
    let roles: { defining_fact_type_id: number; role: string }[] = [];
    let defining_fact_type_id = initialTypeId;
    let role: string | undefined = undefined;

    for (const step of steps) {
        if (step instanceof PropertyCondition) {
            if (step.name === 'type') {
                defining_fact_type_id = getFactTypeId(factTypes, step.value);
                if (defining_fact_type_id && role) {
                    roles.push({ defining_fact_type_id, role });
                }
                role = undefined;
            }
        }
        else if (step instanceof Join) {
            if (step.direction === Direction.Predecessor) {
                if (defining_fact_type_id) {
                    roles.push({ defining_fact_type_id, role: step.role });
                }
                role = undefined;
            }
            else {
                role = step.role;
            }
            defining_fact_type_id = undefined;
        }
        else if (step instanceof ExistentialCondition) {
            roles = roles.concat(allRoles(step.steps, factTypes, defining_fact_type_id));
        }
    }

    return roles;
}
