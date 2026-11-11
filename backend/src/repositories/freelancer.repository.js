import { plain, skillInclude, skillData } from './database-tools.js';

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function createFreelancerRepository(database) {
  return {
    // метод поиска публичных профилей исполнителей с навыками, рейтингами и пагинацией
    async list(query) {
      const where = {};

      if (query.skill)
        where.user_id = {
          in: (
            await database.user_skills.findMany({
              where: { skill: { slug: query.skill } },
              select: { user_id: true },
            })
          ).map((row) => row.user_id),
        };

      if (query.minRating !== undefined) where.freelancer_rating = { gte: query.minRating };

      let rows = plain(await database.v_public_profiles.findMany({ where }));

      if (query.search)
        rows = rows.filter((row) =>
          [row.first_name, row.last_name, row.first_name, row.username]
            .join(' ')
            .toLowerCase()
            .includes(query.search.toLowerCase()),
        );

      const byName = (a, b, includeUsername = true) =>
        compare(a.last_name.toLowerCase(), b.last_name.toLowerCase()) ||
        compare(a.first_name.toLowerCase(), b.first_name.toLowerCase()) ||
        (includeUsername ? compare(a.username.toLowerCase(), b.username.toLowerCase()) : 0) ||
        compare(a.user_id, b.user_id);

      rows.sort(
        query.sort === 'rating'
          ? (a, b) =>
              (a.freelancer_rating === null && b.freelancer_rating === null
                ? 0
                : a.freelancer_rating === null
                  ? 1
                  : b.freelancer_rating === null
                    ? -1
                    : Number(b.freelancer_rating) - Number(a.freelancer_rating)) ||
              b.freelancer_review_count - a.freelancer_review_count ||
              byName(a, b, false)
          : byName,
      );

      const items = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
      const skills = await database.user_skills.findMany({
        where: { user_id: { in: items.map((row) => row.user_id) } },
        ...skillInclude,
      });

      return {
        total: rows.length,
        items: items.map((row) => ({
          ...row,
          skills: skills.filter((link) => link.user_id === row.user_id).map(skillData),
        })),
      };
    },
  };
}
