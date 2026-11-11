import { Prisma } from '@prisma/client';

const lockTables = new Set([
  'users',
  'projects',
  'orders',
  'proposals',
  'project_invitations',
  'stored_files',
  'portfolio_items',
  'reviews',
  'complaints',
  'order_submissions',
  'order_deadline_requests',
  'auth_sessions',
  'skills',
  'categories',
]);

// единственные служебные запросы: время PostgreSQL и блокировки существующих строк

export async function databaseNow(database) {
  const [row] = await database.$queryRaw`SELECT clock_timestamp() AS now`;

  return row.now;
}

export async function lockRows(database, table, ids, shared = false) {
  if (!lockTables.has(table)) throw new TypeError('Unknown lock table');

  if (!ids.length) return [];

  const name = Prisma.raw(`"workify"."${table}"`);
  const mode = shared ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`;
  const rows = await database.$queryRaw`
    SELECT id FROM ${name}
    WHERE id IN (${Prisma.join([...new Set(ids)].map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id ${mode}
  `;

  return rows.map((row) => row.id);
}

export async function lockAccountChanges(database) {
  await database.$queryRaw`SELECT pg_advisory_xact_lock(173204,24)::text`;
}

// сохранение прежних типов данных на границе репозитория и сервиса

export function plain(value) {
  if (value instanceof Prisma.Decimal) return value.toFixed(2);

  if (typeof value === 'bigint') return Number(value);

  if (value instanceof Date || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map(plain);

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
}

export const newest = [{ created_at: 'desc' }, { id: 'desc' }];

export const oldest = [{ created_at: 'asc' }, { id: 'asc' }];

export const activeStatuses = ['IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED'];

export const blockingStatuses = [...activeStatuses, 'COMPLETED'];

export const participant = (id) => ({ OR: [{ customer_id: id }, { freelancer_id: id }] });

export const activeUser = (now) => ({
  OR: [{ status: 'ACTIVE' }, { blocked_until: { lte: now } }],
});

export const contains = (value) => ({
  contains: value.replace(/[\\%_]/g, '\\$&'),
  mode: 'insensitive',
});

export const date = (value) => (value == null ? null : new Date(value));

export const fields = (input, map) =>
  Object.fromEntries(
    Object.entries(map)
      .filter(([key]) => Object.hasOwn(input, key))
      .map(([key, column]) => [column, input[key]]),
  );

// список и его количество читаются из одного снимка базы

export async function page(database, model, query, options = {}) {
  const read = async (client) => {
    const [total, items] = await Promise.all([
      client[model].count({ where: options.where }),
      client[model].findMany({
        ...options,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: plain(items) };
  };

  return database.$transaction
    ? database.$transaction(read, { isolationLevel: 'RepeatableRead' })
    : read(database);
}

export async function replaceLinks(database, table, key, id, column, ids) {
  await database[table].deleteMany({ where: { [key]: id } });

  if (ids.length)
    await database[table].createMany({
      data: ids.map((value) => ({ [key]: id, [column]: value })),
    });
}

export const fileInclude = {
  where: { file: { deleted_at: null } },
  include: { file: true },
  orderBy: [{ file: { created_at: 'asc' } }, { file_id: 'asc' }],
};

export const userInclude = { include: { profile: true } };

export function fileData(link, hash = false) {
  const file = link.file;

  return {
    id: file.id,
    originalName: file.original_name,
    mimeType: file.mime_type,
    sizeBytes: Number(file.size_bytes),
    createdAt: file.created_at,
    ...(hash ? { sha256: file.sha256 } : {}),
  };
}

export const skillData = (link) => ({
  id: link.skill.id,
  slug: link.skill.slug,
  name: link.skill.name,
});

export const skillInclude = {
  include: { skill: true },
  orderBy: [{ skill: { name: 'asc' } }, { skill_id: 'asc' }],
};
