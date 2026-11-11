import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config/env.js';
import { createDatabasePool } from '../../src/config/database.js';
import { createPrismaClient } from '../../src/config/prisma.js';
import { withTransaction } from '../../src/repositories/transaction.js';
import { createFreelancerRepository } from '../../src/repositories/freelancer.repository.js';
import { createProjectRepository } from '../../src/repositories/project.repository.js';
import { createAuditRepository } from '../../src/repositories/audit.repository.js';

if (process.env.WORKIFY_DB_TESTS !== '1') {
  throw new Error('Use the disposable database in scripts/test-infrastructure.mjs');
}

const pool = createDatabasePool(loadConfig({ ...process.env, NODE_ENV: 'test' }).database);
const prisma = createPrismaClient(pool);

after(async () => {
  await prisma.$disconnect();
  await pool.end();
});

async function isolated(operation) {
  const rollback = new Error('rollback comparison fixtures');

  try {
    await withTransaction(prisma, async (database) => {
      await operation(database);
      throw rollback;
    });
    assert.fail('comparison fixtures must be rolled back');
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function user(database, marker, username, id = randomUUID()) {
  await database.users.create({
    data: { id, email: `${id}@example.invalid`, username, password_hash: 'test-only' },
  });
  await database.profiles.create({
    data: { user_id: id, first_name: marker, last_name: 'Одинаковая' },
  });

  return id;
}

test('Prisma freelancer pagination matches SQL tie-breaking for equal names and absent ratings', async () => {
  await isolated(async (database) => {
    const marker = randomUUID();
    const ids = [randomUUID(), randomUUID()].sort();

    await user(database, marker, `zz_${marker.replaceAll('-', '')}`, ids[0]);
    await user(database, marker, `aa_${marker.replaceAll('-', '')}`, ids[1]);

    const repository = createFreelancerRepository(database);

    for (const sort of ['name', 'rating']) {
      const expected =
        sort === 'rating'
          ? await database.$queryRaw`
            SELECT user_id FROM workify.v_public_profiles WHERE first_name=${marker}
            ORDER BY freelancer_rating DESC NULLS LAST,freelancer_review_count DESC,
              lower(last_name),lower(first_name),user_id
          `
          : await database.$queryRaw`
            SELECT user_id FROM workify.v_public_profiles WHERE first_name=${marker}
            ORDER BY lower(last_name),lower(first_name),lower(username),user_id
          `;

      for (const page of [1, 2]) {
        const actual = await repository.list({ search: marker, sort, page, pageSize: 1 });

        assert.equal(actual.total, 2);
        assert.deepEqual(
          actual.items.map((row) => row.user_id),
          [expected[page - 1].user_id],
          sort,
        );
      }
    }
  });
});

test('Prisma project search and budget pagination match SQL across title boundaries and NULL budgets', async () => {
  await isolated(async (database) => {
    const marker = randomUUID();
    const owner = await user(database, marker, `p_${marker.replaceAll('-', '')}`);

    for (const budget of [null, '2500.50', '99.10']) {
      await database.projects.create({
        data: {
          customer_id: owner,
          title: `${marker} граница`,
          description: 'поиска между полями',
          budget,
        },
      });
    }

    const expected = await database.$queryRaw`
      SELECT p.id,p.budget::text AS budget FROM workify.projects p
      WHERE p.customer_id=${owner}::uuid
        AND strpos(lower(p.title || ' ' || p.description),lower(${'граница поиска'}))>0
      ORDER BY p.budget ASC NULLS LAST,p.id ASC
    `;
    const repository = createProjectRepository(database);

    for (const page of [1, 2, 3]) {
      const actual = await repository.list(
        { search: 'граница поиска', sort: 'budget_asc', page, pageSize: 1 },
        owner,
      );

      assert.equal(actual.total, expected.length);
      assert.deepEqual(
        actual.items.map(({ id, budget }) => ({ id, budget })),
        [expected[page - 1]],
      );
    }
  });
});

test('Prisma audit search matches SQL literal substring search for percent and underscore', async () => {
  await isolated(async (database) => {
    const marker = randomUUID();
    const actorId = await user(database, marker, `a_${marker.replaceAll('-', '')}`);
    const repository = createAuditRepository(database);

    for (const action of ['PARITY_%_MATCH', 'PARITY_XYZ_MATCH']) {
      await repository.audit(actorId, action, 'user', actorId);
    }

    for (const search of ['%_', 'parity_%_', 'PARITY_XYZ']) {
      const expected = await database.$queryRaw`
        SELECT a.id FROM workify.audit_logs a
        LEFT JOIN workify.users u ON u.id=a.actor_id
        LEFT JOIN workify.profiles p ON p.user_id=a.actor_id
        WHERE a.actor_id=${actorId}::uuid
          AND strpos(lower(concat_ws(' ',u.username,p.first_name,p.last_name,
            a.action,a.entity_type,a.entity_id::text)),lower(${search}))>0
        ORDER BY a.created_at,a.id
      `;
      const actual = await repository.list({
        actorId,
        search,
        sort: 'oldest',
        page: 1,
        pageSize: 24,
      });

      assert.equal(actual.total, expected.length);
      assert.deepEqual(
        actual.items.map((row) => row.id),
        expected.map((row) => row.id),
      );
    }
  });
});
