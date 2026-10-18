import pg from 'pg';

export function createDatabasePool(config, logger = console) {
  const pool = new pg.Pool(config);
  pool.on('error', () => logger.error(JSON.stringify({ event: 'database_pool_error', code: 'DATABASE_UNAVAILABLE' })));
  return pool;
}
