import { databaseError } from '../utils/database-error.js';

// все переданные репозитории должны использовать один клиент текущей транзакции

export async function withTransaction(prisma, operation) {
  try {
    return await prisma.$transaction(operation);
  } catch (error) {
    throw databaseError(error);
  }
}
