import { md, pki, util } from "node-forge";
import { PoolClient } from 'pg';
import { canonicalizeFact, computeHash } from '../fact/hash';
import { Keystore, UserIdentity } from '../keystore';
import { FactEnvelope, FactRecord, FactSignature, PredecessorCollection } from '../storage';
import { Trace } from "../util/trace";
import { ConnectionFactory } from './connection';

interface KeyPair {
    publicPem: string;
    privatePem: string;
};

export class PostgresKeystore implements Keystore {
    private connectionFactory: ConnectionFactory;
    private cache: Map<string, KeyPair> = new Map();

    constructor (postgresUri: string) {
        this.connectionFactory = new ConnectionFactory(postgresUri);
    }

    async close() {
        await this.connectionFactory.close();
    }

    getOrCreateUserFact(userIdentity: UserIdentity): Promise<FactRecord> {
        return this.getOrCreateIdentityFact('Jinaga.User', userIdentity);
    }

    getOrCreateDeviceFact(deviceIdentity: UserIdentity): Promise<FactRecord> {
        return this.getOrCreateIdentityFact('Jinaga.Device', deviceIdentity);
    }

    getUserFact(userIdentity: UserIdentity): Promise<FactRecord> {
        return this.getIdentityFact('Jinaga.User', userIdentity);
    }

    getDeviceFact(deviceIdentity: UserIdentity): Promise<FactRecord> {
        return this.getIdentityFact('Jinaga.Device', deviceIdentity);
    }

    async signFacts(userIdentity: UserIdentity, facts: FactRecord[]): Promise<FactEnvelope[]> {
        if (!userIdentity) {
            return [];
        }
        
        const { publicPem, privatePem } = await this.getKeyPair(userIdentity);
        const privateKey = <pki.rsa.PrivateKey>pki.privateKeyFromPem(privatePem);
        const envelopes: FactEnvelope[] = facts.map(fact => signFact(fact, publicPem, privateKey));
        return envelopes;
    }

    private async getOrCreateIdentityFact(type: string, identity: UserIdentity): Promise<FactRecord> {
        if (!identity) {
            return null;
        }
        const { publicPem } = await this.getOrGenerateKeyPair(identity);
        const predecessors: PredecessorCollection = {};
        const fields = {
            publicKey: publicPem
        };
        const hash = computeHash(fields, predecessors);
        return { type, hash, predecessors, fields };
    }

    private async getIdentityFact(type: string, identity: UserIdentity): Promise<FactRecord> {
        if (!identity) {
            return null;
        }
        const { publicPem } = await this.getKeyPair(identity);
        const predecessors: PredecessorCollection = {};
        const fields = {
            publicKey: publicPem
        };
        const hash = computeHash(fields, predecessors);
        return { type, hash, predecessors, fields };
    }

    private async getKeyPair(userIdentity: UserIdentity): Promise<KeyPair> {
        const key = getUserIdentityKey(userIdentity);
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        const keyPair = await this.connectionFactory.with(connection =>
            this.selectKeyPair(connection, userIdentity));
        this.cache.set(key, keyPair);
        return keyPair;
    }

    private async selectKeyPair(connection: PoolClient, userIdentity: UserIdentity): Promise<KeyPair> {
        const { rows } = await connection.query('SELECT public_key, private_key FROM public.user WHERE provider = $1 AND user_identifier = $2',
            [userIdentity.provider, userIdentity.id]);
        if (rows.length > 1) {
            throw new Error('Duplicate entries found in the keystore');
        }
        else if (rows.length === 1) {
            const publicPem = <string>rows[0]["public_key"];
            const privatePem = rows[0]["private_key"];
            return { publicPem, privatePem };
        }
        else {
            throw new Error('No entry found in the keystore');
        }
    }

    private async getOrGenerateKeyPair(userIdentity: UserIdentity): Promise<KeyPair> {
        const key = getUserIdentityKey(userIdentity);
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        const keyPair = await this.connectionFactory.withTransaction(connection =>
            this.selectOrInsertKeyPair(connection, userIdentity));
        this.cache.set(key, keyPair);
        return keyPair;
    }

    private async selectOrInsertKeyPair(connection: PoolClient, userIdentity: UserIdentity): Promise<KeyPair> {
        const { rows } = await connection.query('SELECT public_key, private_key FROM public.user WHERE provider = $1 AND user_identifier = $2',
            [userIdentity.provider, userIdentity.id]);
        if (rows.length > 1) {
            throw new Error('Duplicate entries found in the keystore');
        }
        else if (rows.length === 1) {
            const publicPem: string = rows[0]["public_key"];
            const privatePem: string = rows[0]["private_key"];
            return { publicPem, privatePem };
        }
        else {
            const keyPair = await this.generateKeyPair(connection, userIdentity);
            return keyPair;
        }
    }

    private async generateKeyPair(connection: PoolClient, userIdentity: UserIdentity): Promise<KeyPair> {
        const keypair = pki.rsa.generateKeyPair({ bits: 2048 });
        const privatePem = pki.privateKeyToPem(keypair.privateKey);
        const publicPem = pki.publicKeyToPem(keypair.publicKey);
        await connection.query('INSERT INTO public.user (provider, user_identifier, private_key, public_key) VALUES ($1, $2, $3, $4)',
            [userIdentity.provider, userIdentity.id, privatePem, publicPem]);
        return { publicPem, privatePem };
    }
}

function getUserIdentityKey(userIdentity: UserIdentity) {
    return `${userIdentity.provider}-${userIdentity.id}`;
}

function signFact(fact: FactRecord, publicPem: string, privateKey: pki.rsa.PrivateKey): FactEnvelope {
    const canonicalString = canonicalizeFact(fact.fields, fact.predecessors);
    const encodedString = util.encodeUtf8(canonicalString);
    const digest = md.sha512.create().update(encodedString);
    const hash = util.encode64(digest.digest().getBytes());
    if (fact.hash !== hash) {
        Trace.error(`Hash does not match. "${fact.hash}" !== "${hash}"\nFact: ${canonicalString}`);
        return {
            fact,
            signatures: []
        };
    }
    const signature = util.encode64(privateKey.sign(digest));
    return {
        fact,
        signatures: [{
            signature,
            publicKey: publicPem
        }]
    };
}
