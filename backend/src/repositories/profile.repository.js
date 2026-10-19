const skills = `COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name)
  ORDER BY s.name, s.id) FROM workify.user_skills us JOIN workify.skills s ON s.id = us.skill_id
  WHERE us.user_id = p.user_id), '[]'::jsonb) AS skills`;
const accountColumns = { email: 'email', username: 'username' };
const profileColumns = { firstName: 'first_name', lastName: 'last_name', headline: 'headline',
  description: 'description', phone: 'phone', city: 'city', country: 'country' };

export function createProfileRepository(database) {
  function assignments(columns, input) {
    // SQL identifiers come exclusively from the internal maps, never request keys.
    const entries = Object.entries(columns).filter(([key]) => Object.hasOwn(input, key));
    return { sql: entries.map(([, column], index) => `${column} = $${index + 2}`).join(', '),
      values: entries.map(([key]) => input[key]) };
  }
  return {
    async findOwn(userId) {
      return (await database.query(`SELECT u.id, u.email, u.username, p.first_name, p.last_name,
        p.headline, p.description, p.phone, p.city, p.country, p.created_at, p.updated_at, ${skills}
        FROM workify.users u JOIN workify.profiles p ON p.user_id = u.id WHERE u.id = $1`, [userId])).rows[0];
    },
    async findPublic(userId) {
      return (await database.query(`SELECT p.*, ${skills} FROM workify.v_public_profiles p WHERE p.user_id = $1`, [userId])).rows[0];
    },
    async lockAccount(userId) {
      return (await database.query(`SELECT id, email, username, password_hash, role, status, blocked_until
        FROM workify.users WHERE id = $1 FOR UPDATE`, [userId])).rows[0];
    },
    async updateAccount(userId, patch) {
      const changes = assignments(accountColumns, patch);
      if (changes.values.length) await database.query(`UPDATE workify.users SET ${changes.sql} WHERE id = $1`, [userId, ...changes.values]);
    },
    async updateProfile(userId, patch) {
      const changes = assignments(profileColumns, patch);
      await database.query(`UPDATE workify.profiles SET ${changes.sql || 'updated_at = clock_timestamp()'} WHERE user_id = $1`, [userId, ...changes.values]);
    },
    async listSkills() {
      return (await database.query('SELECT id, slug, name FROM workify.skills ORDER BY name, id')).rows;
    },
    async findSkillIds(ids) {
      return (await database.query('SELECT id FROM workify.skills WHERE id = ANY($1::uuid[]) FOR SHARE', [ids])).rows.map(row => row.id);
    },
    async replaceSkills(userId, ids) {
      await database.query('DELETE FROM workify.user_skills WHERE user_id = $1', [userId]);
      await database.query('INSERT INTO workify.user_skills (user_id, skill_id) SELECT $1, unnest($2::uuid[])', [userId, ids]);
      await database.query('UPDATE workify.profiles SET updated_at = clock_timestamp() WHERE user_id = $1', [userId]);
    },
  };
}
