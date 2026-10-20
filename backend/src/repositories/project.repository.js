import {createAuditRepository} from './audit.repository.js';
const activeCustomer = "u.role='CLIENT' AND (u.status='ACTIVE' OR u.blocked_until <= now())";
const relations = `JOIN workify.users u ON u.id=p.customer_id JOIN workify.profiles profile ON profile.user_id=u.id
  LEFT JOIN workify.categories c ON c.id=p.category_id`;
const columns = `p.id,p.customer_id,p.category_id,p.title,p.description,p.budget::text AS budget,p.desired_deadline_at,p.status,
  p.published_at,p.completed_at,p.cancelled_at,p.cancellation_reason,p.created_at,p.updated_at,
  c.slug AS category_slug,c.name AS category_name,u.username,profile.first_name,profile.last_name,
  (${activeCustomer}) AS customer_active,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'slug',s.slug,'name',s.name) ORDER BY s.name,s.id)
    FROM workify.project_skills ps JOIN workify.skills s ON s.id=ps.skill_id WHERE ps.project_id=p.id),'[]'::jsonb) AS skills,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'originalName',f.original_name,'mimeType',f.mime_type,
    'sizeBytes',f.size_bytes,'sha256',f.sha256,'createdAt',f.created_at) ORDER BY f.created_at,f.id)
    FROM workify.project_files pf JOIN workify.stored_files f ON f.id=pf.file_id WHERE pf.project_id=p.id AND f.deleted_at IS NULL),'[]'::jsonb) AS files`;
export function createProjectRepository(database) {
  return {
    audit:createAuditRepository(database).audit,
    async categories() { return (await database.query('SELECT id,slug,name FROM workify.categories ORDER BY name,id')).rows; },
    async list(query, ownerId) {
      const values = [], conditions = [];
      const bind = value => { values.push(value); return `$${values.length}`; };
      if (ownerId) conditions.push(`p.customer_id=${bind(ownerId)}`);
      else conditions.push(`p.status='OPEN'`, activeCustomer);
      if (query.status) conditions.push(`p.status=${bind(query.status)}`);
      if (query.search) conditions.push(`strpos(lower(p.title || ' ' || p.description),lower(${bind(query.search)}))>0`);
      if (query.category) conditions.push(`c.slug=${bind(query.category)}`);
      if (query.skill) conditions.push(`EXISTS (SELECT 1 FROM workify.project_skills ps JOIN workify.skills s ON s.id=ps.skill_id WHERE ps.project_id=p.id AND s.slug=${bind(query.skill)})`);
      if (query.minBudget !== undefined) conditions.push(`p.budget>=${bind(query.minBudget)}::numeric`);
      if (query.maxBudget !== undefined) conditions.push(`p.budget<=${bind(query.maxBudget)}::numeric`);
      const timestamp = ownerId ? 'p.created_at' : 'p.published_at';
      const sorts = { newest: `${timestamp} DESC,p.id DESC`, oldest: `${timestamp} ASC,p.id ASC`,
        budget_asc: 'p.budget ASC NULLS LAST,p.id ASC', budget_desc: 'p.budget DESC NULLS LAST,p.id ASC', deadline_asc: 'p.desired_deadline_at ASC NULLS LAST,p.id ASC' };
      const sort = sorts[query.sort];
      const limit = bind(query.pageSize), offset = bind((query.page - 1) * query.pageSize);
      return (await database.query(`WITH matches AS (SELECT p.id FROM workify.projects p ${relations} WHERE ${conditions.join(' AND ')}),
        page AS (SELECT ${columns},row_number() OVER (ORDER BY ${sort}) AS position FROM workify.projects p
          JOIN matches m ON m.id=p.id ${relations} ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset})
        SELECT (SELECT count(*) FROM matches)::int AS total,
          COALESCE((SELECT jsonb_agg(page ORDER BY position) FROM page),'[]'::jsonb) AS items`,values)).rows[0];
    },
    async findVisible(id, actorId) {
      return (await database.query(`SELECT ${columns} FROM workify.projects p ${relations}
        WHERE p.id=$1 AND (p.customer_id=$2::uuid OR (p.status='OPEN' AND ${activeCustomer}))`,[id,actorId??null])).rows[0];
    },
    async lockOwn(id,actorId) { return (await database.query('SELECT * FROM workify.projects WHERE id=$1 AND customer_id=$2 FOR UPDATE',[id,actorId])).rows[0]; },
    async countOwn(actorId) { return Number((await database.query('SELECT count(*) FROM workify.projects WHERE customer_id=$1',[actorId])).rows[0].count); },
    async validReferences(categoryId,skillIds) {
      const category = categoryId ? (await database.query('SELECT id FROM workify.categories WHERE id=$1 FOR SHARE',[categoryId])).rowCount === 1 : true;
      const skills = (await database.query('SELECT id FROM workify.skills WHERE id=ANY($1::uuid[]) FOR SHARE',[skillIds])).rowCount === skillIds.length;
      return { category,skills };
    },
    async insert(actorId,input) {
      return (await database.query(`INSERT INTO workify.projects (customer_id,title,description,category_id,budget,desired_deadline_at)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,[actorId,input.title,input.description,input.categoryId,input.budget,input.desiredDeadlineAt])).rows[0].id;
    },
    async update(id,input) { await database.query(`UPDATE workify.projects SET title=$2,description=$3,category_id=$4,budget=$5,desired_deadline_at=$6 WHERE id=$1`,[id,input.title,input.description,input.categoryId,input.budget,input.desiredDeadlineAt]); },
    async skills(id) { return (await database.query('SELECT skill_id FROM workify.project_skills WHERE project_id=$1 ORDER BY skill_id',[id])).rows.map(row=>row.skill_id); },
    async files(id) { return (await database.query('SELECT file_id FROM workify.project_files WHERE project_id=$1 ORDER BY file_id',[id])).rows.map(row=>row.file_id); },
    async replaceSkills(id,ids) {
      await database.query('DELETE FROM workify.project_skills WHERE project_id=$1',[id]);
      await database.query('INSERT INTO workify.project_skills (project_id,skill_id) SELECT $1,unnest($2::uuid[])',[id,ids]);
    },
    async replaceFiles(id,ids) {
      await database.query('DELETE FROM workify.project_files WHERE project_id=$1',[id]);
      await database.query('INSERT INTO workify.project_files (project_id,file_id) SELECT $1,unnest($2::uuid[])',[id,ids]);
    },
    async publish(id) { await database.query("UPDATE workify.projects SET status='OPEN',published_at=clock_timestamp() WHERE id=$1",[id]); },
    async cancel(id,reason) { await database.query("UPDATE workify.projects SET status='CANCELLED',cancelled_at=clock_timestamp(),cancellation_reason=$2 WHERE id=$1",[id,reason]); },
    async closePending(id,reason) {
      const proposals=(await database.query("UPDATE workify.proposals SET status='REJECTED',decided_at=clock_timestamp(),closure_reason=$2 WHERE project_id=$1 AND status='PENDING' RETURNING id,customer_id,freelancer_id",[id,reason])).rows;
      const invitations=(await database.query("UPDATE workify.project_invitations SET status='EXPIRED',decided_at=clock_timestamp(),closure_reason=$2 WHERE project_id=$1 AND status='PENDING' RETURNING id,customer_id,freelancer_id",[id,reason])).rows;return {proposals,invitations};
    },
    async notifyClosed(recipientId,kind,sourceId,projectId,status,reason){const column=kind==='proposal'?'proposal_id':'invitation_id';await database.query(`INSERT INTO workify.notifications(recipient_id,event_type,project_id,${column},message,metadata) VALUES($1,$2,$3,$4,'Предложение закрыто: условия проекта изменились или проект отменён',$5::jsonb)`,[recipientId,kind==='proposal'?'PROPOSAL_STATUS_CHANGED':'INVITATION_STATUS_CHANGED',projectId,sourceId,JSON.stringify({status,reason})]);},
    async blockingOrder(id) { return (await database.query("SELECT 1 FROM workify.orders WHERE project_id=$1 AND status IN ('IN_PROGRESS','SUBMITTED','REVISION_REQUESTED','COMPLETED') LIMIT 1",[id])).rowCount>0; },
    async hasHistory(id) { return (await database.query(`SELECT EXISTS(SELECT 1 FROM workify.proposals WHERE project_id=$1)
      OR EXISTS(SELECT 1 FROM workify.project_invitations WHERE project_id=$1) OR EXISTS(SELECT 1 FROM workify.orders WHERE project_id=$1) AS found`,[id])).rows[0].found; },
    async remove(id) { await database.query('DELETE FROM workify.projects WHERE id=$1',[id]); },
  };
}
