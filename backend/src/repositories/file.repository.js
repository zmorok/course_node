// Keep every association here: a generic delete must respect future private contexts too.
const references = ['profile_files', 'portfolio_files', 'project_files', 'order_files', 'submission_files', 'complaint_files'];
const isUsed = alias => references.map(table => `EXISTS (SELECT 1 FROM workify.${table} r WHERE r.file_id = ${alias}.id)`).join(' OR ');
export function createFileRepository(database) {
  return {
    async lockActor(id) {
      return (await database.query('SELECT id, role, status, blocked_until FROM workify.users WHERE id=$1 FOR UPDATE', [id])).rows[0];
    },
    async countOwn(id) { return Number((await database.query('SELECT count(*) FROM workify.stored_files WHERE uploaded_by=$1 AND deleted_at IS NULL', [id])).rows[0].count); },
    async insert(actorId, file) {
      return (await database.query(`INSERT INTO workify.stored_files (uploaded_by, storage_key, original_name, mime_type, size_bytes, sha256)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [actorId, file.storageKey, file.originalName, file.mimeType, file.sizeBytes, file.sha256])).rows[0];
    },
    async listOwn(actorId) {
      return (await database.query(`SELECT f.*, (${isUsed('f')}) AS in_use FROM workify.stored_files f
        WHERE uploaded_by=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id`, [actorId])).rows;
    },
    async lockFiles(ids) {
      return (await database.query('SELECT * FROM workify.stored_files WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE', [ids])).rows;
    },
    async used(id) {
      return (await database.query(`SELECT (${isUsed('f')}) AS used FROM workify.stored_files f WHERE id=$1`, [id])).rows[0]?.used;
    },
    async findReadable(id, actorId) {
      return (await database.query(`SELECT f.* FROM workify.stored_files f WHERE f.id=$1 AND f.deleted_at IS NULL
        AND (f.uploaded_by=$2::uuid OR EXISTS (SELECT 1 FROM workify.profile_files pf
          JOIN workify.v_public_profiles p ON p.user_id=pf.user_id WHERE pf.file_id=f.id)
        OR EXISTS (SELECT 1 FROM workify.portfolio_files pf JOIN workify.portfolio_items i ON i.id=pf.portfolio_item_id
          JOIN workify.v_public_profiles p ON p.user_id=i.user_id WHERE pf.file_id=f.id)
        OR EXISTS (SELECT 1 FROM workify.project_files pf JOIN workify.projects p ON p.id=pf.project_id
          JOIN workify.v_public_profiles customer ON customer.user_id=p.customer_id
          WHERE pf.file_id=f.id AND p.status='OPEN')
        OR EXISTS (SELECT 1 FROM workify.order_files ofile JOIN workify.orders o ON o.id=ofile.order_id
          WHERE ofile.file_id=f.id AND $2::uuid IN (o.customer_id,o.freelancer_id))
        OR EXISTS (SELECT 1 FROM workify.submission_files sf JOIN workify.order_submissions s ON s.id=sf.submission_id
          JOIN workify.orders o ON o.id=s.order_id WHERE sf.file_id=f.id AND $2::uuid IN (o.customer_id,o.freelancer_id))
        OR EXISTS (SELECT 1 FROM workify.users admin WHERE admin.id=$2::uuid AND admin.role='ADMIN' AND (admin.status='ACTIVE' OR admin.blocked_until<=statement_timestamp())
          AND (EXISTS(SELECT 1 FROM workify.complaint_files cf WHERE cf.file_id=f.id)
            OR EXISTS(SELECT 1 FROM workify.order_files ofile JOIN workify.complaints c ON c.order_id=ofile.order_id WHERE ofile.file_id=f.id)
            OR EXISTS(SELECT 1 FROM workify.submission_files sf JOIN workify.order_submissions s ON s.id=sf.submission_id JOIN workify.complaints c ON c.order_id=s.order_id WHERE sf.file_id=f.id)
            OR EXISTS(SELECT 1 FROM workify.project_files pf JOIN workify.orders o ON o.project_id=pf.project_id JOIN workify.complaints c ON c.order_id=o.id WHERE pf.file_id=f.id))))`, [id, actorId ?? null])).rows[0];
    },
    async markUnusedDeleted(ids) {
      await database.query(`UPDATE workify.stored_files f SET deleted_at=clock_timestamp()
        WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL AND NOT (${isUsed('f')})`, [ids]);
    },
    async pendingDeletes() { return (await database.query('SELECT id,storage_key FROM workify.stored_files WHERE deleted_at IS NOT NULL ORDER BY deleted_at LIMIT 100')).rows; },
    async finishDelete(id) { await database.query('DELETE FROM workify.stored_files WHERE id=$1 AND deleted_at IS NOT NULL', [id]); },
    async avatar(userId) { return (await database.query('SELECT file_id FROM workify.profile_files WHERE user_id=$1', [userId])).rows[0]?.file_id ?? null; },
    async setAvatar(userId, fileId) {
      await database.query('DELETE FROM workify.profile_files WHERE user_id=$1', [userId]);
      if (fileId) await database.query('INSERT INTO workify.profile_files (user_id,file_id) VALUES ($1,$2)', [userId,fileId]);
      await database.query('UPDATE workify.profiles SET updated_at=clock_timestamp() WHERE user_id=$1', [userId]);
    },
  };
}
