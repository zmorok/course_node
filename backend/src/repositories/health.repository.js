import { pool } from '../config/database.js';

export async function checkDatabase() {
  const result = await pool.query('SELECT 1 AS ready');
  if (result.rows[0]?.ready !== 1) throw new Error('Database readiness check failed');
}
