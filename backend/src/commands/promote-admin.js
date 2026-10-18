// Explicit operator command; never exposed through HTTP or run during startup.
import { loadConfig } from '../config/env.js';
import { createDatabasePool } from '../config/database.js';
import { createAuthRepository } from '../repositories/auth.repository.js';
import { accountEmailInput } from '../validators/auth.js';

let pool;
try {
  const { email } = accountEmailInput({ email: process.argv[2] });
  const config = loadConfig();
  pool = createDatabasePool(config.database);
  const user = await createAuthRepository(pool).promoteToAdmin(email);
  if (!user) throw new Error('Account not found');
  console.log('Administrator role granted to the existing account.');
} catch {
  console.error('Could not grant administrator role. Pass the email of an existing registered account and check the database connection.');
  process.exitCode = 1;
} finally { await pool?.end(); }
