// Explicit operator command; never exposed through HTTP or run during startup.
import { loadConfig } from '../config/env.js';
import { createDatabasePool } from '../config/database.js';
import { createAuthRepository } from '../repositories/auth.repository.js';
import { accountEmailInput } from '../validators/auth.js';
import {withTransaction} from '../repositories/transaction.js';

let pool;
try {
  const { email } = accountEmailInput({ email: process.argv[2] });
  const config = loadConfig();
  pool = createDatabasePool(config.database);
  const user=await withTransaction(pool,async client=>{const repo=createAuthRepository(client),found=await repo.findByEmail(email);if(!found)return null;const current=await repo.lockForLogin(found.id);if(current.role==='ADMIN')return current;const changed=await repo.promoteToAdmin(email);if(changed)await repo.audit(null,'ADMIN_GRANTED','user',changed.id,{source:'operator-command'},{oldData:{role:current.role},newData:{role:'ADMIN'}});return changed;});
  if (!user) throw new Error('Account not found');
  console.log('Administrator role granted to the existing account.');
} catch {
  console.error('Could not grant administrator role. Pass the email of an existing registered account and check the database connection.');
  process.exitCode = 1;
} finally { await pool?.end(); }
