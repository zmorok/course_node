import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// использование существующего пула, которым управляет приложение
export function createPrismaClient(pool) {
  return new PrismaClient({
    adapter: new PrismaPg(pool, { schema: 'workify', disposeExternalPool: false }),
    log: [],
  });
}
