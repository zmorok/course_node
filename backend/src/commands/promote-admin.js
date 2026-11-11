// скрипт для однократного ручного назначения первого администратора после регистрации
// не вызывается через HTTP и не запускается автоматически при старте приложения
import { loadConfig } from '../config/env.js';
import { createDatabasePool } from '../config/database.js';
import { createPrismaClient } from '../config/prisma.js';
import { createAuthRepository } from '../repositories/auth.repository.js';
import { accountEmailInput } from '../validators/auth.js';
import { withTransaction } from '../repositories/transaction.js';

let pool;
let prisma;

try {
  const { email } = accountEmailInput({ email: process.argv[2] });
  const config = loadConfig();

  pool = createDatabasePool(config.database);
  prisma = createPrismaClient(pool);

  const user = await withTransaction(prisma, async (client) => {
    const transactionRepository = createAuthRepository(client);
    const found = await transactionRepository.findByEmail(email);

    if (!found) {
      return null;
    }

    const current = await transactionRepository.lockForLogin(found.id);

    if (current.role === 'ADMIN') {
      return current;
    }

    const changed = await transactionRepository.promoteToAdmin(email);

    if (changed) {
      await transactionRepository.audit(
        null,
        'ADMIN_GRANTED',
        'user',
        changed.id,
        { source: 'operator-command' },
        { oldData: { role: current.role }, newData: { role: 'ADMIN' } },
      );
    }

    return changed;
  });

  if (!user) {
    throw new Error('Account not found');
  }

  console.log('Administrator role granted to the existing account.');
} catch {
  console.error(
    'Could not grant administrator role. Pass the email of an existing registered account and check the database connection.',
  );
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
  await pool?.end();
}
