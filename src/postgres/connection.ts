import { Pool, PoolClient } from 'pg';
import { delay } from "../util/promise";

export type Row = { [key: string]: any };

export class ConnectionFactory {
    private postgresPool: Pool;

    constructor (postgresUri: string) {
        this.postgresPool = new Pool({
            connectionString: postgresUri
        });
    }

    async close() {
        await this.postgresPool.end();
    }

    withTransaction<T>(callback: (connection: PoolClient) => Promise<T>) {
        return this.with(async connection => {
            try {
                await connection.query('BEGIN');
                const result = await callback(connection);
                await connection.query('COMMIT');
                return result;
            }
            catch (e) {
                await connection.query('ROLLBACK');
                throw e;
            }
        })
    }

    async with<T>(callback: (connection: PoolClient) => Promise<T>) {
        let attempt = 0;
        const pause = [0, 0, 1000, 5000, 15000, 30000];
        while (attempt < pause.length) {
            try {
                const client = await this.createClient();
                try {
                    return await callback(client);
                }
                finally {
                    client.release();
                }
            }
            catch (e) {
                attempt++;
                if (attempt === pause.length) {
                    throw e;
                }
            }
            if (pause[attempt] > 0) {
                await delay(pause[attempt]);
            }
        }
    }

    private async createClient() {
        return await this.postgresPool.connect();
    }
}