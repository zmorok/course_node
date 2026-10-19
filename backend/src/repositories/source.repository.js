// Shared locking and audit SQL for both ways of assigning a project.
export function createSourceRepository(database){return {
  async projectContext(id){return (await database.query('SELECT id,customer_id FROM workify.projects WHERE id=$1',[id])).rows[0];},
  async lockUsers(ids){return (await database.query('SELECT id,role,status,blocked_until FROM workify.users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[...new Set(ids)]])).rows;},
  async lockProject(id){return (await database.query('SELECT * FROM workify.projects WHERE id=$1 FOR UPDATE',[id])).rows[0];},
  async audit(actorId,action,entityType,entityId,metadata={}){await database.query('INSERT INTO workify.audit_logs (actor_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5::jsonb)',[actorId,action,entityType,entityId,JSON.stringify(metadata)]);},
};}
