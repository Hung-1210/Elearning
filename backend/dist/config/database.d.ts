import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
export declare const pool: Pool;
/** Interface with .query(): compatible with both Pool and PoolClient */
export interface Db {
    query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<R>>;
}
export declare function query<T = any>(text: string, params?: unknown[]): Promise<T[]>;
export declare function queryOne<T = any>(text: string, params?: unknown[]): Promise<T | null>;
/** Runs fn within a transaction. Rolls back on error, commits on success. */
export declare function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
export declare function testConnection(): Promise<void>;
//# sourceMappingURL=database.d.ts.map