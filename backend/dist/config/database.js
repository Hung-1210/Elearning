"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
exports.queryOne = queryOne;
exports.withTransaction = withTransaction;
exports.testConnection = testConnection;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'elearning',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
};
exports.pool = new pg_1.Pool(poolConfig);
exports.pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
    process.exit(-1);
});
async function query(text, params) {
    const client = await exports.pool.connect();
    try {
        const result = await client.query(text, params);
        return result.rows;
    }
    finally {
        client.release();
    }
}
async function queryOne(text, params) {
    const rows = await query(text, params);
    return rows[0] ?? null;
}
/** Runs fn within a transaction. Rolls back on error, commits on success. */
async function withTransaction(fn) {
    const client = await exports.pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
async function testConnection() {
    try {
        await exports.pool.query('SELECT NOW()');
        console.log('✅ PostgreSQL connected successfully');
    }
    catch (error) {
        console.error('❌ PostgreSQL connection failed:', error);
        throw error;
    }
}
//# sourceMappingURL=database.js.map