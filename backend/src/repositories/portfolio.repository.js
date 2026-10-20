import {createAuditRepository} from './audit.repository.js';
const columns = `i.id,i.user_id,i.title,i.description,i.links,i.experience,i.skills,i.created_at,i.updated_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'originalName',f.original_name,'mimeType',f.mime_type,
    'sizeBytes',f.size_bytes,'sha256',f.sha256,'createdAt',f.created_at) ORDER BY f.created_at,f.id)
    FROM workify.portfolio_files pf JOIN workify.stored_files f ON f.id=pf.file_id
    WHERE pf.portfolio_item_id=i.id AND f.deleted_at IS NULL), '[]'::jsonb) AS files`;
export function createPortfolioRepository(database) {
  return {
    audit:createAuditRepository(database).audit,
    async list(userId) { return (await database.query(`SELECT ${columns} FROM workify.portfolio_items i WHERE user_id=$1 ORDER BY created_at DESC,id`,[userId])).rows; },
    async publicUser(userId) { return (await database.query('SELECT user_id FROM workify.v_public_profiles WHERE user_id=$1',[userId])).rows[0]; },
    async find(id,userId,lock=false) {
      return (await database.query(`SELECT ${columns} FROM workify.portfolio_items i WHERE id=$1 AND user_id=$2 ${lock ? 'FOR UPDATE OF i' : ''}`,[id,userId])).rows[0];
    },
    async insert(userId,input) { return (await database.query(`INSERT INTO workify.portfolio_items (user_id,title,description,links,experience,skills)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,[userId,input.title,input.description,input.links,input.experience,input.skills])).rows[0].id; },
    async update(id,input) { await database.query('UPDATE workify.portfolio_items SET title=$2,description=$3,links=$4,experience=$5,skills=$6 WHERE id=$1',[id,input.title,input.description,input.links,input.experience,input.skills]); },
    async replaceFiles(id,ids) {
      await database.query('DELETE FROM workify.portfolio_files WHERE portfolio_item_id=$1',[id]);
      await database.query('INSERT INTO workify.portfolio_files (portfolio_item_id,file_id) SELECT $1,unnest($2::uuid[])',[id,ids]);
    },
    async remove(id) { await database.query('DELETE FROM workify.portfolio_items WHERE id=$1',[id]); },
  };
}
