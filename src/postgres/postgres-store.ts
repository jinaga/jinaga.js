import { PoolClient } from 'pg';
import { Query } from '../query/query';
import { FactEnvelope, FactPath, FactRecord, FactReference, factReferenceEquals, Storage } from '../storage';
import { flatten } from '../util/fn';
import { ConnectionFactory, Row } from './connection';
import { makeEdgeRecords } from './edge-record';
import { sqlFromSteps } from './sql';

function loadFactRecord(r: Row): FactRecord {
    return {
        type: r.type,
        hash: r.hash,
        predecessors: JSON.parse(r.predecessors),
        fields: JSON.parse(r.fields)
    };
}

function loadFactReference(r: Row): FactReference {
    return {
        type: r.type,
        hash: r.hash
    };
}

function loadFactPath(pathLength: number, r: Row): FactPath {
    let path: FactPath = [];
    for (let i = 0; i < pathLength; i++) {
        path.push({
            type: r['type' + i],
            hash: r['hash' + i]
        });
    }
    return path;
}

export class PostgresStore implements Storage {
    private connectionFactory: ConnectionFactory;

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
                const factTypes = await storeFactTypes(facts, connection);
                const newFacts = await filterNewFacts(facts, factTypes, connection);
                await insertEdges(newFacts, connection);
                await insertFacts(newFacts, connection);
                await insertSignatures(envelopes, connection);
                return envelopes.filter(envelope => newFacts.some(
                    factReferenceEquals(envelope.fact)));
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
        
        const sqlQuery = sqlFromSteps(start, query.steps);
        if (!sqlQuery) {
            throw new Error(`Could not generate SQL for query "${query.toDescriptiveString()}"`);
        }
        const { rows } = await this.connectionFactory.with(async (connection) => {
            return await connection.query(sqlQuery.sql, sqlQuery.parameters);
        });
        return rows.map(row => loadFactPath(sqlQuery.pathLength, row));
    }

    async exists(fact: FactReference): Promise<boolean> {
        const sql = 'SELECT COUNT(1) AS count FROM public.fact WHERE type=$1 AND hash=$2';
        const parameters = [ fact.type, fact.hash ];
        const { rows } = await this.connectionFactory.with(async (connection) => {
            return await connection.query(sql, parameters);
        });
        return rows[0].count > 0;
    }

    async load(references: FactReference[]): Promise<FactRecord[]> {
        if (references.length === 0) {
            return [];
        }

        const tuples = references.map((r, i) => '($' + (i*2 + 1) + ', $' + (i*2 + 2) + ')');
        const parameters = flatten(references, (r) => [r.type, r.hash]);
        const sql =
            'WITH RECURSIVE a(ancestor_hash, ancestor_type, hash, type) AS (' +
            ' SELECT v.hash AS ancestor_hash, v.type AS ancestor_type, v.hash, v.type' +
            ' FROM (VALUES ' + tuples.join(', ') + ') AS v (type, hash)' +
            ' UNION ALL' +
            ' SELECT e.predecessor_hash AS ancestor_hash, e.predecessor_type AS ancestor_type, a.hash, a.type' +
            ' FROM a' +
            ' JOIN public.edge e ON e.successor_hash = a.ancestor_hash AND e.successor_type = a.ancestor_type)' +
            ' SELECT fact.type, fact.hash, fact.fields, fact.predecessors' +
            ' FROM (SELECT DISTINCT a.ancestor_hash, a.ancestor_type FROM a) AS d' +
            ' JOIN public.fact ON d.ancestor_type = fact.type AND d.ancestor_hash = fact.hash;';
        const { rows } = await this.connectionFactory.with(async (connection) => {
            return await connection.query(sql, parameters);
        })
        return rows.map(loadFactRecord);
    }
}

interface FactTypeResult {
    rows: {
        fact_type_id: number;
        name: string;
    }[];
}

async function storeFactTypes(facts: FactRecord[], connection: PoolClient) {
    // Look up existing fact types
    const types = facts.map(fact => fact.type);
    const lookUpSql = 'SELECT name, fact_type_id FROM public.fact_type WHERE name=ANY($1);';
    const { rows: existingRows }: FactTypeResult = await connection.query(lookUpSql, [types]);
    const factTypeIds = existingRows.reduce(
        (map, row) => map.set(row.name, row.fact_type_id),
        new Map<string, number>()
    );
    const remainingNames = types.filter(type => !factTypeIds.has(type));
    if (remainingNames.length === 0) {
        return factTypeIds;
    }

    // Insert new fact types
    const insertSql = 'INSERT INTO public.fact_type (name) VALUES ' +
        remainingNames.map((name, index) => `($${index+1})`).join(', ') +
        ' RETURNING fact_type_id, name;';
    const { rows: newRows }: FactTypeResult = await connection.query(insertSql, remainingNames);
    if (newRows.length !== remainingNames.length) {
        throw new Error('Failed to insert all new fact types.');
    }
    const allFactTypeIds = newRows.reduce(
        (map, row) => map.set(row.name, row.fact_type_id),
        factTypeIds
    );
    return allFactTypeIds;
}

async function filterNewFacts(facts: FactRecord[], factTypes: Map<string, number>, connection: PoolClient) {
    if (facts.length > 0) {
        const factValues = facts.map((f, i) =>
            '($' + (i * 2 + 1) + ', $' + (i * 2 + 2) + '::integer)');
        const factParameters = flatten(facts, (f) =>
            [f.hash, factTypes.get(f.type)]);

        const { rows } = await connection.query('SELECT hash, fact_type_id' +
            '  FROM (VALUES ' + factValues.join(', ') + ') AS v(hash, fact_type_id)' +
            '  WHERE NOT EXISTS (SELECT 1 FROM public.fact' +
            '   WHERE fact.hash = v.hash AND fact.fact_type_id = v.fact_type_id);', factParameters);
            
        const newFactReferences = rows.map(loadFactReference);
        return facts.filter(f => newFactReferences.some(factReferenceEquals(f)));
    }
    else {
        return [];
    }
}

async function insertEdges(facts: FactRecord[], connection: PoolClient) {
    const edgeRecords = flatten(facts, makeEdgeRecords);
    if (edgeRecords.length > 0) {
        const edgeValues = edgeRecords.map((e, i) =>
            '($' + (i * 5 + 1) + ', $' + (i * 5 + 2) + ', $' + (i * 5 + 3) + ', $' + (i * 5 + 4) + ', $' + (i * 5 + 5) + ')');
        const edgeParameters = flatten(edgeRecords, (e) =>
            [e.predecessor_hash, e.predecessor_type, e.successor_hash, e.successor_type, e.role]);

        await connection.query('INSERT INTO public.edge' +
            ' (predecessor_hash, predecessor_type, successor_hash, successor_type, role)' +
            ' (VALUES ' + edgeValues.join(', ') + ')' +
            ' ON CONFLICT DO NOTHING', edgeParameters);
    }
}

async function insertFacts(facts: FactRecord[], connection: PoolClient) {
    if (facts.length > 0) {
        const factValues = facts.map((f, i) =>
            '($' + (i * 4 + 1) + ', $' + (i * 4 + 2) + ', $' + (i * 4 + 3) + ', $' + (i * 4 + 4) + ')');
        const factParameters = flatten(facts, (f) =>
            [f.hash, f.type, JSON.stringify(f.fields), JSON.stringify(f.predecessors)]);

        await connection.query('INSERT INTO public.fact' +
            ' (hash, type, fields, predecessors)' +
            ' (SELECT hash, type, to_jsonb(fields), to_jsonb(predecessors)' +
            '  FROM (VALUES ' + factValues.join(', ') + ') AS v(hash, type, fields, predecessors))' +
            ' ON CONFLICT DO NOTHING', factParameters);
    }
}

async function insertSignatures(envelopes: FactEnvelope[], connection: PoolClient) {
    const signatureRecords = flatten(envelopes, envelope => envelope.signatures.map(signature => ({
        type: envelope.fact.type,
        hash: envelope.fact.hash,
        publicKey: signature.publicKey,
        signature: signature.signature
    })));
    if (signatureRecords.length > 0) {
        const signatureValues = signatureRecords.map((s, i) =>
            `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`);
        const signatureParameters = flatten(signatureRecords, s =>
            [s.hash, s.type, s.publicKey, s.signature]);

        await connection.query(`INSERT INTO public.signature
            (hash, type, public_key, signature) 
            (SELECT hash, type, public_key, signature 
            FROM (VALUES ${signatureValues.join(', ')}) AS v(hash, type, public_key, signature) 
            WHERE NOT EXISTS (SELECT 1 FROM public.signature 
            WHERE signature.hash = v.hash AND signature.type = v.type AND signature.public_key = v.public_key))
            ON CONFLICT DO NOTHING`, signatureParameters);
    }
}