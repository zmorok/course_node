import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export class ConfigurationError extends Error {
  constructor(fields) {
    super(`Invalid environment variables: ${fields.join(', ')}`);
    this.name = 'ConfigurationError';
    this.fields = fields;
  }
}

export function loadConfig(source = process.env) {
  const invalid = [];
  function text(key, fallback, { secret = false } = {}) {
    const raw = source[key] ?? fallback;
    if (typeof raw !== 'string' || !raw.trim() || /[\r\n\0]/.test(raw)) {
      invalid.push(key);
      return '';
    }
    return secret ? raw : raw.trim();
  }
  function integer(key, fallback, min, max) {
    const raw = source[key] ?? String(fallback);
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max) invalid.push(key);
    return value;
  }
  const nodeEnv = text('NODE_ENV', 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) invalid.push('NODE_ENV');
  const uploadDir = text('UPLOAD_DIR', fileURLToPath(new URL('../../uploads/', import.meta.url)));
  if (!isAbsolute(uploadDir)) invalid.push('UPLOAD_DIR');
  const config = {
    nodeEnv,
    port: integer('PORT', 3000, 1, 65535),
    uploadDir,
    jsonLimitBytes: integer('HTTP_JSON_LIMIT_BYTES', 65536, 1024, 1048576),
    database: Object.freeze({
      host: text('PGHOST', 'postgres'),
      port: integer('PGPORT', 5432, 1, 65535),
      database: text('PGDATABASE', 'workify'),
      user: text('PGUSER', 'workify'),
      password: text('PGPASSWORD', undefined, { secret: true }),
      max: integer('PGPOOL_MAX', 5, 1, 50),
      connectionTimeoutMillis: integer('PG_CONNECTION_TIMEOUT_MS', 2000, 100, 30000),
      idleTimeoutMillis: integer('PG_IDLE_TIMEOUT_MS', 10000, 1000, 60000),
      query_timeout: integer('PG_QUERY_TIMEOUT_MS', 2000, 100, 60000),
      statement_timeout: integer('PG_STATEMENT_TIMEOUT_MS', 2000, 100, 60000),
    }),
  };
  if (invalid.length) throw new ConfigurationError([...new Set(invalid)]);
  return Object.freeze(config);
}
