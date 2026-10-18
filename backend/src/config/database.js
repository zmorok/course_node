import pg from 'pg';
import { env } from './env.js';

export const pool = new pg.Pool({
  ...env.database,
  max: 5,
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 10000,
  query_timeout: 2000,
  statement_timeout: 2000,
});

pool.on('error', () => console.error('Database pool connection lost'));
